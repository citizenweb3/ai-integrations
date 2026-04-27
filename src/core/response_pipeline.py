"""Shared response pipeline — used by both reactive listener and proactive scanner."""

import json
import re
import uuid
import logging

log = logging.getLogger(__name__)


_URL_RE = re.compile(r'https?://[^\s)\]\>]+')
_URL_PARSE_RE = re.compile(r'^(https?)://([^/?#]+)([/?#].*)?$')
_ALLOWED_DOMAIN_SUFFIXES = (
    "validatorinfo.com",
    "podcast.citizenweb3.com",
    "bvc.citizenweb3.com",
)


def detect_language(text: str) -> str:
    ru, en = 0, 0
    for c in text:
        if 'Ѐ' <= c <= 'ӿ': ru += 1
        elif 'a' <= c.lower() <= 'z': en += 1
    return "RU" if ru > en else "EN"


async def format_messages_with_ours(db, messages: list[dict], chat_id: int) -> str:
    our_responses = {}
    async with db.db.execute(
        """SELECT in_reply_to, draft_text, sent_at FROM responses
           WHERE chat_id = ? AND status = 'sent' AND in_reply_to IS NOT NULL
           ORDER BY sent_at""",
        (chat_id,),
    ) as cur:
        for row in await cur.fetchall():
            our_responses[row[0]] = row[1]

    lines = []
    for m in messages:
        lines.append(f"{m.get('sender_name', '?')}: {m.get('text', '')}")
        msg_id = m.get("message_id")
        if msg_id and msg_id in our_responses:
            lines.append(f"Aida (you): {our_responses[msg_id]}")
    return "\n".join(lines)


async def get_dm_already_sent(db, chat_id: int, sender_id: int | None = None) -> dict:
    dm_sent = {"chat": False, "validatorinfo": False, "podcast": False}

    if sender_id:
        async with db.db.execute(
            "SELECT dm_text FROM responses WHERE target_user_id = ? AND status = 'sent' AND response_type = 'dm'",
            (sender_id,),
        ) as cur:
            for row in await cur.fetchall():
                t = (row[0] or "").lower()
                if "web_3_society" in t:
                    dm_sent["chat"] = True
                if "validatorinfo" in t:
                    dm_sent["validatorinfo"] = True
                if "podcast.citizenweb3" in t:
                    dm_sent["podcast"] = True

    return dm_sent


_ALLOWED_HOSTS = frozenset(_ALLOWED_DOMAIN_SUFFIXES)


def _validate_response_payload(
    payload: dict, is_reply_to_us: bool, community_chat: str
) -> tuple[dict, str | None]:
    """Normalize dm_request/dm_text to a safe shape.

    Drops the DM (dm_request=False, dm_text="") on any failure: not a direct
    reply, empty text, no URL, non-HTTPS URL, host not in whitelist. Hosts
    must match exactly (no subdomains). The community_chat URL is allowed
    verbatim as a special case.
    """
    out = dict(payload)

    def reject(reason: str) -> tuple[dict, str | None]:
        out["dm_request"] = False
        out["dm_text"] = ""
        return out, reason

    requested = bool(out.get("dm_request", False))
    text = (out.get("dm_text", "") or "").strip()

    if not requested:
        out["dm_request"] = False
        out["dm_text"] = ""
        return out, None

    if not is_reply_to_us:
        return reject("dm_request=true but not reply_to_us")

    if not text:
        return reject("dm_request=true but dm_text empty")

    urls = _URL_RE.findall(text)
    if not urls:
        return reject("dm_text has no URL")

    exact_chat = community_chat.rstrip("/")

    for raw in urls:
        url = raw.rstrip(".,;:)\"'")
        if url == exact_chat:
            continue
        m = _URL_PARSE_RE.match(url)
        if not m:
            return reject(f"unparseable URL {raw!r}")
        scheme, host, _ = m.groups()
        if scheme != "https":
            return reject(f"non-HTTPS URL {raw!r}")
        host = host.lower()
        if host in _ALLOWED_HOSTS:
            continue
        return reject(f"URL host not in whitelist: {host!r}")

    out["dm_request"] = True
    out["dm_text"] = text
    return out, None


async def _persist_tool_calls(db, audit_id: str, phase: str, tool_calls: list[dict]):
    for tc in tool_calls:
        await db.save_tool_call(
            audit_id=audit_id,
            phase=phase,
            sequence=tc.get("sequence", 0),
            tool_name=tc.get("tool_name", ""),
            tool_input=tc.get("tool_input"),
            tool_output=tc.get("tool_output"),
            latency_ms=tc.get("latency_ms"),
        )


async def generate_response(
    db, responder, approval, config,
    chat_id: int, message_id: int, sender_id: int | None,
    sender_name: str, text: str, topic: str | None,
    group_name: str, is_reply_to_us: bool = False,
    use_reply_model: bool = False,
    is_proactive: bool = False,
):
    """Full response pipeline: prompt → Claude → save → approval. Returns response_id or None."""
    audit_id = str(uuid.uuid4())
    await db.init_audit_log(
        audit_id=audit_id,
        chat_id=chat_id, message_id=message_id, sender_id=sender_id,
        original_text=text, topic=topic,
        status="generating",
    )

    recent = await db.get_recent_messages(chat_id, limit=10)
    formatted_messages = await format_messages_with_ours(db, recent, chat_id)
    dm_sent = await get_dm_already_sent(db, chat_id, sender_id)

    prompt = responder.make_prompt(
        group_name=group_name,
        recent_messages=formatted_messages,
        sender_name=sender_name, message_text=text,
        is_reply_to_us=is_reply_to_us,
        dm_already_sent=dm_sent,
    )

    # Phase 1: generation
    result1, tool_calls1 = await responder.generate(prompt, use_reply_model=use_reply_model)
    await _persist_tool_calls(db, audit_id, "generation", tool_calls1)

    if result1 is None:
        error = responder.last_error
        await db.update_audit_log(
            audit_id, status="error",
            claude_prompt=prompt,
            error=error or "no_result",
        )
        if error and error in ("auth_error", "auth_locked", "degraded_mode_entered", "rate_limit"):
            level = "CRITICAL" if "auth" in error else "WARNING"
            detail = responder.last_error_detail or ""
            await approval.alert(level, f"Claude: {error} {detail}".strip())
        return None

    action = result1.get("action")
    reply_text = result1.get("text", "")
    confidence = float(result1.get("confidence", 0) or 0)

    if action != "respond" or confidence < 0.7 or not reply_text:
        log.info("[%s] Claude skipped (action=%s, conf=%.2f)", group_name, action, confidence)
        await db.update_audit_log(
            audit_id, status="skipped_phase1",
            claude_prompt=prompt,
            claude_raw=json.dumps(result1),
            claude_parsed=json.dumps(result1),
        )
        return None

    # M1: Verifier doesn't see DM fields. Pipeline preserves Phase 1 DM intent.
    original_dm_request = bool(result1.get("dm_request", False))
    original_dm_text = result1.get("dm_text", "") or ""

    # Phase 2: verification for confidence in [0.7, 0.9). >=0.9 sends directly.
    final_result = result1
    verified = False
    tool_calls2: list[dict] = []
    if confidence < 0.9:
        log.info("[%s] Phase 2: verifying response (conf=%.2f)", group_name, confidence)
        verify_prompt = responder.make_verification_prompt(
            original_question=text,
            draft_response=reply_text,
            initial_confidence=confidence,
        )
        result2, tool_calls2 = await responder.generate(
            verify_prompt, use_reply_model=use_reply_model, is_verification=True
        )
        await _persist_tool_calls(db, audit_id, "verification", tool_calls2)

        if result2 is None:
            log.info("[%s] Phase 2: verification call failed, skipping", group_name)
            await db.update_audit_log(
                audit_id, status="error",
                claude_prompt=prompt,
                claude_raw=json.dumps(result1),
                claude_parsed=json.dumps(result1),
                error=responder.last_error or "verification_failed",
            )
            return None

        new_conf = float(result2.get("confidence", 0) or 0)
        new_action = result2.get("action")
        new_text = result2.get("text", "")
        if new_action != "respond" or new_conf < 0.9 or not new_text:
            log.info("[%s] Phase 2: not verified (action=%s, conf=%.2f→%.2f), skipping",
                     group_name, new_action, confidence, new_conf)
            await db.update_audit_log(
                audit_id, status="skipped_phase2",
                claude_prompt=prompt,
                claude_raw=json.dumps(result1),
                claude_parsed=json.dumps(result2),
            )
            return None
        log.info("[%s] Phase 2: verified (conf=%.2f→%.2f)", group_name, confidence, new_conf)
        # Merge: keep result2 text/conf/action/reason, restore DM from result1.
        final_result = dict(result2)
        final_result["dm_request"] = original_dm_request
        final_result["dm_text"] = original_dm_text
        reply_text = new_text
        confidence = new_conf
        verified = True

    # H2 deterministic gate: no tool grounding in either phase AND high
    # confidence → clamp to 0.85 (below send threshold) and skip.
    if not tool_calls1 and not tool_calls2 and confidence >= 0.9:
        log.info("[%s] H2 clamp: no tool grounding in either phase, conf %.2f → 0.85", group_name, confidence)
        confidence = 0.85
        log.info("[%s] After H2 clamp, below send threshold, skipping", group_name)
        await db.update_audit_log(
            audit_id, status="skipped_h2_clamp",
            claude_prompt=prompt,
            claude_raw=json.dumps(result1),
            claude_parsed=json.dumps(final_result),
        )
        return None

    # Post-processing: dashes
    reply_text = reply_text.replace("—", ",").replace("–", ",")

    # M2 + M3: validate DM payload (URL whitelist, normalize invalid).
    community_chat = config.get("target", {}).get("community_chat", "https://t.me/web_3_society")
    final_result, validation_msg = _validate_response_payload(
        final_result, is_reply_to_us=is_reply_to_us, community_chat=community_chat,
    )
    if validation_msg:
        log.info("[%s] DM validation: dropped (%s)", group_name, validation_msg)

    contains_link = bool(re.search(r'https?://', reply_text))
    dm_request = bool(final_result.get("dm_request", False))
    dm_text = (final_result.get("dm_text", "") or "").replace("—", ",").replace("–", ",")
    dm_text_to_send = dm_text if dm_request else None

    group_info = await db.get_group(chat_id)
    if contains_link and group_info and group_info.get("link_tolerance") == "forbidden":
        log.info("[%s] Skipping: link_tolerance=forbidden", group_name)
        await db.update_audit_log(
            audit_id, status="blocked_link_tolerance",
            claude_prompt=prompt,
            claude_raw=json.dumps(result1),
            claude_parsed=json.dumps(final_result),
        )
        return None

    base_type = "proactive" if is_proactive else "value"
    if verified:
        model_used = responder._model_verification
    elif use_reply_model:
        model_used = responder._model_reply
    else:
        model_used = responder._model

    response_id = await db.save_response(
        chat_id=chat_id, in_reply_to=message_id,
        draft_text=reply_text,
        response_type=base_type,
        confidence=confidence, reason=final_result.get("reason", ""),
        model_name=model_used,
        prompt_hash=responder.prompt_hash(prompt),
        contains_link=contains_link,
    )

    await db.update_audit_log(
        audit_id, status="ready_for_approval",
        claude_prompt=prompt,
        claude_raw=json.dumps(result1),
        claude_parsed=json.dumps(final_result),
    )

    language = detect_language(text)
    group_today = await db.count_responses_today(chat_id)
    last_resp = group_info.get("last_response_at", "never") if group_info else "never"
    log_type = "dm" if dm_request else base_type

    if dm_request:
        await approval.send_approval(
            response_id=response_id, chat_id=chat_id,
            group_name=group_name, language=language,
            sender_name=sender_name, original_text=text,
            reply_text=reply_text,
            response_type=base_type,
            is_proactive=is_proactive,
            confidence=confidence,
            contains_link=contains_link,
            group_daily_count=group_today,
            group_daily_limit=config["limits"]["messages_per_group_per_day"],
            last_response_ago=str(last_resp),
        )
        dm_response_id = await db.save_response(
            chat_id=chat_id, in_reply_to=None,
            draft_text=dm_text_to_send or "",
            response_type="dm",
            confidence=confidence, reason="DM request",
            model_name=model_used,
            prompt_hash="",
            contains_link=True,
            target_user_id=sender_id,
            dm_text=dm_text_to_send,
        )
        await approval.send_approval(
            response_id=dm_response_id, chat_id=chat_id,
            group_name=group_name, language=language,
            sender_name=sender_name,
            original_text=f"@{sender_name} просит ссылку",
            reply_text=dm_text_to_send or "",
            response_type="dm",
            confidence=confidence,
            contains_link=True,
            group_daily_count=group_today,
            group_daily_limit=config["limits"]["messages_per_group_per_day"],
            last_response_ago=str(last_resp),
        )
        log.info("[%s] DM request from %s — two approvals sent", group_name, sender_name)
    else:
        await approval.send_approval(
            response_id=response_id, chat_id=chat_id,
            group_name=group_name, language=language,
            sender_name=sender_name, original_text=text,
            reply_text=reply_text,
            response_type=base_type,
            confidence=confidence,
            rag_summary="",
            db_summary="",
            contains_link=contains_link,
            is_proactive=is_proactive,
            group_daily_count=group_today,
            group_daily_limit=config["limits"]["messages_per_group_per_day"],
            last_response_ago=str(last_resp),
        )

    log.info("[%s] Response candidate sent to approval (conf=%.2f, type=%s)", group_name, confidence, log_type)
    return response_id
