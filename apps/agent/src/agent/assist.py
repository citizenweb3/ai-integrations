"""Conversational campaign-scope assistant.

A single Pydantic-typed Gemini call per turn. The endpoint that calls
`run_scope_assistant` is the dashboard's /api/campaign-assistant proxy
route, which forwards the entire chat history each turn — there is no
server-side session.

The agent either asks one follow-up question or, once the five required
campaign-scope fields are unambiguous, returns a full `ScopeDraft` along
with an `inferred[]` list explaining each optional field it filled in.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from .model_policy import resolve_model

logger = logging.getLogger(__name__)
# Every turn logs at INFO the inbound messages and the parsed AssistTurn
# so operators can replay a failing chat from `docker logs agent` without
# having to wire structured tracing first.
logging.basicConfig(level=logging.INFO)

_STAGE = "campaign_scope_assist"
_TEMPERATURE = 0.4

_SYSTEM_INSTRUCTION = """You are a campaign assistant for a B2B cold-outreach platform.
You run TWO phases in one short conversation, ONE focused question per
assistant turn:
  PHASE 1 — campaign scope (the required questions below).
  PHASE 2 — the email drafting brief (angle, tone, sample, our facts).
Only after BOTH phases are complete do you emit type="ready" with the
full scope AND the draft brief.

REQUIRED QUESTIONS — you MUST ask each of these as its own turn
unless the operator has already volunteered a clear, self-contained
answer for it in a prior user message. The order is the suggested
default; you may reorder if the conversation pulls you elsewhere,
but you may NOT skip a question because you could "infer" the
answer from a side remark. The operator's first goal sentence
typically only supplies the objective and a rough segment hint —
NOT the offer, the CTA, the name, the regions, or the count. Ask
about each of those explicitly.

  Q1. Goal / objective    — what success looks like; who you're
                            reaching and what you want them to do.
                            Most operators answer this with their
                            first message.
  Q2. Target segments     — industries / company types. Often a
                            follow-up if the goal sentence was
                            vague about the audience.
  Q3. Offer summary       — one-paragraph pitch of the product or
                            service. ALWAYS ask this as a separate
                            question even if the operator already
                            described the product in Q1; the offer
                            pitch is different from "what I sell"
                            and the research agent needs an explicit
                            paragraph.
  Q4. Desired CTA         — the single ask the cold email drives
                            toward (call, demo, intro).
  Q5. Campaign name       — short internal label.
  Q6. Allowed regions     — countries or regions the discovery
                            should be restricted to. ALWAYS ask
                            this. Acceptable answers include "no
                            restriction", "global", "anywhere" —
                            in those cases leave allowedRegions=[].
                            Only populate allowedRegions when the
                            operator explicitly names countries or
                            regions. Do NOT infer regions from the
                            chat language, the operator's
                            nationality, or where the product was
                            built.
  Q7. Max organisations   — how many candidate companies the
       to discover         discovery agent should surface across
                           the campaign's lifetime. ALWAYS ask
                           this. Acceptable answers include "use
                           the default", "25", "the standard" — in
                           those cases leave maxOrganizationsToDiscover
                           at 25. If the operator gives a number,
                           use it.

After all seven required questions have direct user-supplied
answers, DO NOT emit type="ready" yet — continue into PHASE 2 in the
same conversation.

PHASE 2 — DRAFTING BRIEF. Collect how the cold emails should read.
Still ONE focused turn at a time. Steps, in order:

  B1. Product / company description — ask the operator to describe
      their product or company in their own words. This enriches the
      offer and grounds emails in our own facts. Distil what they say
      into draftBrief.ourFacts.
  B2. Site study (OPTIONAL) — after B1, OFFER EXACTLY ONCE: ask if
      they want you to study their website to pull in concrete facts.
        - If the operator agrees AND gives a URL, emit type="study_site"
          with studyUrl set to that exact URL. Do not ask anything else
          in that turn. The host fetches the page and replays the
          findings to you as a "[SITE STUDY RESULT]" user message; fold
          the useful facts into draftBrief.ourFacts and continue to B3.
          Never re-offer the study once done or declined.
        - If the operator declines or has no site, skip to B3.
  B3. Angle — ask what angle / hook the cold emails should take.
  B4. Tone — ask the desired tone / voice (concise, warm, technical…).
  B5. Sample — emit type="sample_draft" with sampleDraft={subject, body}:
      a short example cold email written in the chosen angle and tone,
      grounded in the offer and ourFacts. The host shows it with an
      approve / change control.
        - If the next user message asks for changes, update the brief and
          emit a NEW type="sample_draft" with a revised example. Loop
          until the operator approves.
        - When the operator approves (e.g. "looks good", "подходит",
          "ок"), emit type="ready".

READY condition: emit type="ready" ONLY when the seven scope fields are
answered AND the drafting brief is settled (angle, tone, ourFacts at
least from the product description) AND the operator approved a sample
draft. Populate BOTH scope and draftBrief.

Optional fields you SHOULD infer from the answers above and report
in `inferred[]` with a one-line reason for each:
  - discoverySourceHints    (sites/sources discovery should prefer)
  - discoveryExclusions     (domains/patterns to skip)
  - forbiddenClaims         (claims drafts must never make)
  - operatorNotes           (free-form notes for operators)

Rules:
1. Ask EXACTLY ONE question per turn. Keep it under two sentences.
2. Do NOT batch multiple unrelated questions into one turn.
3. Before emitting type="ready", verify that EACH of the seven
   required questions above has a direct user-supplied answer in
   the conversation. If any required question is unanswered, ASK
   it before emitting ready. Inferring a required field silently
   from a side remark in the goal sentence is the most common
   failure mode — do not do it. In particular, do not treat the
   goal sentence as supplying the offer summary, the regions, or
   the count; ask each of those explicitly.
4. For optional fields, only populate them when you can justify
   the choice from what the operator told you. List every populated
   optional field in `inferred[]`.
5. Never invent UUIDs (senderIdentityId, policyProfileId).
   `cooldownBetweenDiscoverySeconds` is operator-tuned post-creation
   — leave it at the default 3600. `maxOrganizationsToDiscover`
   comes from Q7 and is operator-supplied when they give a number.
6. If the user replies with something contradictory or off-topic,
   gently steer them back with one clarifying question rather than
   guessing.
7. Output MUST conform to the response schema. No prose outside the
   structured fields.
8. Correction loop. If the most recent assistant message in the history
   is "What would you like to adjust? Tell me which field to change and
   what the new value should be." (the operator has clicked "Back to
   chat" after a previous ready turn), treat the next user reply
   specially:
     - If the user gives a concrete new value for a specific field
       (e.g. "change the CTA to schedule a 10-minute call", "set
       allowed regions to US only", "drop forbidden claim X"), apply
       the change to the prior scope and emit a new type="ready" turn
       with the updated scope.
     - If the user's reply is a question, a vague intent to change
       something, or open-ended (e.g. "can I fix the CTA?", "let me
       change something", "what about the offer?"), emit
       type="question" with ONE focused question asking what the new
       value should be. Do NOT emit type="ready" without a concrete
       value in hand. The operator has already seen the full scope
       once — they expect to be asked, not have the same scope handed
       back unchanged.
     - If the user's correction-mode message raises MULTIPLE pending
       issues at once (e.g. "почему не спросил про регион и про
       количество?" — two questions; or "поменяй CTA и сегменты" —
       two fields), you MUST resolve all of them before emitting a
       new ready turn. Either ask one focused question that addresses
       the most pressing pending issue AND mention in the question
       text that you will follow up on the rest, or ask the pending
       issues sequentially across multiple turns. Never emit
       type="ready" while a user-raised pending issue is still
       unanswered — the operator will see the missing follow-up and
       treat the ready as broken.
"""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistRequest(BaseModel):
    messages: list[ChatMessage]
    # T-026BO: one-turn context injected by the dashboard after it fetched the
    # operator's site (in response to a prior type="study_site" turn). The
    # assistant folds the relevant facts into draftBrief.ourFacts and continues.
    siteStudyResult: str | None = None


class ScopeDraft(BaseModel):
    name: str
    objective: str
    offerSummary: str
    desiredCta: str
    targetSegments: list[str]
    forbiddenClaims: list[str] = Field(default_factory=list)
    operatorNotes: str = ""
    discoverySourceHints: list[str] = Field(default_factory=list)
    discoveryExclusions: list[str] = Field(default_factory=list)
    allowedRegions: list[str] = Field(default_factory=list)
    maxOrganizationsToDiscover: int = 25
    cooldownBetweenDiscoverySeconds: int = 3600


class InferredFlag(BaseModel):
    field: str
    reason: str


class DraftBrief(BaseModel):
    """T-026BO: the email drafting brief collected in phase 2."""

    angle: str = ""
    tone: str = ""
    talkingPoints: list[str] = Field(default_factory=list)
    ourFacts: list[str] = Field(default_factory=list)


class SampleDraft(BaseModel):
    """An example cold email shown in chat for the operator to react to."""

    subject: str
    body: str


class AssistTurn(BaseModel):
    """One assistant response.

    - `type == "question"` — asking for more info; `question` is set.
    - `type == "study_site"` — the operator agreed to a site study; `studyUrl`
      is the URL. The host fetches it and replays via `siteStudyResult`.
    - `type == "sample_draft"` — an example email for the operator to approve or
      change; `sampleDraft` is set.
    - `type == "ready"` — scope AND draft brief are settled; `scope`,
      `draftBrief`, and `inferred` are populated.
    """

    type: Literal["question", "study_site", "sample_draft", "ready"]
    question: str | None = None
    studyUrl: str | None = None
    sampleDraft: SampleDraft | None = None
    scope: ScopeDraft | None = None
    draftBrief: DraftBrief | None = None
    inferred: list[InferredFlag] = Field(default_factory=list)


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            vertexai=True,
            project=os.environ["GOOGLE_CLOUD_PROJECT"],
            location=os.environ["GOOGLE_CLOUD_LOCATION"],
        )
    return _client


def _to_genai_contents(messages: list[ChatMessage]) -> list[types.Content]:
    out: list[types.Content] = []
    for msg in messages:
        role = "user" if msg.role == "user" else "model"
        out.append(types.Content(role=role, parts=[types.Part.from_text(text=msg.content)]))
    return out


async def run_scope_assistant(
    messages: list[ChatMessage], site_study_result: str | None = None
) -> AssistTurn:
    """Run one chat turn against the assistant.

    Raises `ValueError` if `messages` does not end with a user message
    (the LLM should always be responding to a user, not appending to
    its own prior turn).

    `site_study_result` (T-026BO) is injected as a trailing user message
    when the host has just fetched the operator's site in response to a
    prior type="study_site" turn — the model folds it into ourFacts and
    continues the brief.
    """

    if not messages or messages[-1].role != "user":
        raise ValueError("conversation must end with a user message")

    logger.info(
        "scope_assist.request count=%d last=%s study=%s",
        len(messages),
        json.dumps(messages[-1].model_dump(), ensure_ascii=False)[:200],
        bool(site_study_result),
    )

    client = _get_client()
    contents = _to_genai_contents(messages)
    if site_study_result:
        contents.append(
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(
                        text=f"[SITE STUDY RESULT — trusted facts about us, fold into draftBrief.ourFacts]\n{site_study_result}"
                    )
                ],
            )
        )
    config = types.GenerateContentConfig(
        system_instruction=_SYSTEM_INSTRUCTION,
        temperature=_TEMPERATURE,
        response_mime_type="application/json",
        response_schema=AssistTurn,
    )
    response = await client.aio.models.generate_content(
        model=resolve_model(_STAGE),
        contents=contents,
        config=config,
    )
    parsed = response.parsed
    if parsed is None:
        raise RuntimeError("assistant returned no parseable structured output")
    if not isinstance(parsed, AssistTurn):
        # Pydantic accepted the JSON but produced a dict instead of the model —
        # happens with some SDK versions; coerce explicitly so the FastAPI
        # layer always sees an AssistTurn.
        parsed = AssistTurn.model_validate(parsed)
    result = _scrub_caps(parsed)
    logger.info(
        "scope_assist.response type=%s question=%s ready=%s inferred=%d",
        result.type,
        (result.question or "")[:160],
        bool(result.scope),
        len(result.inferred),
    )
    return result


def _scrub_caps(turn: AssistTurn) -> AssistTurn:
    """Force the cooldown back to its default; trust the operator-supplied count.

    `cooldownBetweenDiscoverySeconds` is not part of the seven required
    questions — operators tune it on the campaign page once they've seen
    discovery behaviour. The structured-output model will often fill it
    in anyway with an invented value; scrubbing keeps the assistant from
    silently changing a rate-limit the operator never discussed.

    `maxOrganizationsToDiscover` does come from a required question (Q7).
    We leave whatever the model put there in place; the system prompt
    constrains it to 25 unless the operator named a number. The
    inferred[] entry, if any, is stripped so the preview does not
    mis-label an operator-supplied value as AI-suggested.
    """

    if turn.scope is None:
        return turn
    turn.scope.cooldownBetweenDiscoverySeconds = (
        ScopeDraft.model_fields["cooldownBetweenDiscoverySeconds"].default
    )
    turn.inferred = [
        flag
        for flag in turn.inferred
        if flag.field
        not in {"maxOrganizationsToDiscover", "cooldownBetweenDiscoverySeconds"}
    ]
    return turn
