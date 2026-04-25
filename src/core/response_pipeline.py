"""Shared response pipeline — used by both reactive listener and proactive scanner."""

import json
import re
import uuid
import logging

log = logging.getLogger(__name__)


def detect_language(text: str) -> str:
    ru, en = 0, 0
    for c in text:
        if '\u0400' <= c <= '\u04ff': ru += 1
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


async def generate_response(
    db, responder, approval, config,
    chat_id: int, message_id: int, sender_id: int | None,
    sender_name: str, text: str, topic: str | None,
    group_name: str, is_reply_to_us: bool = False,
    use_reply_model: bool = False,
    is_proactive: bool = False,
):
    """Full response pipeline: prompt → Claude → save → approval. Returns response_id or None."""
    recent = await db.get_recent_messages(chat_id, limit=10)
    language = detect_language(text)
    formatted_messages = await format_messages_with_ours(db, recent, chat_id)
    dm_sent = await get_dm_already_sent(db, chat_id, sender_id)

    prompt = responder.make_prompt(
        group_name=group_name, language=language,
        recent_messages=formatted_messages,
        sender_name=sender_name, message_text=text,
        is_reply_to_us=is_reply_to_us,
        dm_already_sent=dm_sent,
    )

    result = await responder.generate(prompt, use_reply_model=use_reply_model)
    if not result:
        error = responder.last_error
        if error and error in ("auth_error", "auth_locked", "degraded_mode_entered", "rate_limit"):
            level = "CRITICAL" if "auth" in error else "WARNING"
            detail = responder.last_error_detail or ""
            await approval.alert(level, f"Claude: {error} {detail}".strip())
        return None

    action = result.get("action")
    reply_text = result.get("text", "")
    confidence = result.get("confidence", 0)

    if action != "respond" or confidence < 0.6 or not reply_text:
        log.info("[%s] Claude skipped (action=%s, conf=%.2f)", group_name, action, confidence)
        return None

    # Phase 2: verification for medium-confidence responses (0.6-0.79)
    verified = False
    if confidence < 0.8:
        log.info("[%s] Phase 2: verifying response (conf=%.2f)", group_name, confidence)
        verify_prompt = responder.make_verification_prompt(
            language=language,
            original_question=text,
            draft_response=reply_text,
            initial_confidence=confidence,
        )
        result2 = await responder.generate(verify_prompt, use_reply_model=use_reply_model, is_verification=True)
        if not result2:
            log.info("[%s] Phase 2: verification call failed, skipping", group_name)
            return None
        new_conf = result2.get("confidence", 0)
        new_action = result2.get("action")
        new_text = result2.get("text", "")
        if new_action != "respond" or new_conf < 0.8 or not new_text:
            log.info("[%s] Phase 2: not verified (action=%s, conf=%.2f→%.2f), skipping", group_name, new_action, confidence, new_conf)
            return None
        log.info("[%s] Phase 2: verified (conf=%.2f→%.2f)", group_name, confidence, new_conf)
        result = result2
        reply_text = new_text
        confidence = new_conf
        verified = True

    # Post-processing
    reply_text = reply_text.replace("—", ",").replace("–", ",")

    contains_link = bool(re.search(r'https?://', reply_text))
    dm_request = result.get("dm_request", False) and is_reply_to_us
    dm_text = result.get("dm_text", "") if dm_request else ""
    dm_text = dm_text.replace("—", ",").replace("–", ",")
    dm_text_to_send = dm_text if dm_request else None

    group_info = await db.get_group(chat_id)
    if contains_link and group_info and group_info.get("link_tolerance") == "forbidden":
        log.info("[%s] Skipping: link_tolerance=forbidden", group_name)
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
        confidence=confidence, reason=result.get("reason", ""),
        model_name=model_used,
        prompt_hash=responder.prompt_hash(prompt),
        contains_link=contains_link,
    )

    await db.save_audit_log(
        audit_id=str(uuid.uuid4()),
        chat_id=chat_id, message_id=message_id, sender_id=sender_id,
        original_text=text, topic=topic,
        claude_prompt=prompt, claude_raw=json.dumps(result),
        claude_parsed=json.dumps(result),
    )

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
