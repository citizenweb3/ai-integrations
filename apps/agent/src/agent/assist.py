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

import os
from typing import Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from .model_policy import resolve_model

_STAGE = "campaign_scope_assist"
_TEMPERATURE = 0.4

_SYSTEM_INSTRUCTION = """You are a campaign-scope assistant for a B2B cold-outreach platform.
Your goal is to collect a complete campaign scope through a short
conversation: ONE focused question per assistant turn until you have
enough information to fill the five required fields.

Required fields you must collect from the operator:
  - name             (short internal label)
  - objective        (what success looks like — drives discovery)
  - offerSummary     (one-paragraph pitch of the product/service)
  - desiredCta       (single ask the email drives toward)
  - targetSegments   (industries / company types — list of strings)

Optional fields you SHOULD infer from objective + targetSegments and
report in `inferred[]` with a one-line reason for each:
  - discoverySourceHints    (sites/sources discovery should prefer)
  - discoveryExclusions     (domains/patterns to skip)
  - allowedRegions          (regions/countries; empty = global)
  - forbiddenClaims         (claims drafts must never make)
  - operatorNotes           (free-form notes for operators)

Rules:
1. Ask EXACTLY ONE question per turn. Keep it under two sentences.
2. Do NOT batch multiple unrelated questions into one turn.
3. Once the five required fields are unambiguous from the
   conversation so far, emit type="ready" with the full scope and
   STOP asking questions.
4. For optional fields, only populate them when you can justify the
   choice from what the operator told you. List every populated
   optional field in `inferred[]`.
5. Never invent UUIDs (senderIdentityId, policyProfileId) and never
   set non-default values for the numeric caps
   (maxOrganizationsToDiscover, cooldownBetweenDiscoverySeconds) —
   leave the defaults; operators tune them later.
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
"""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistRequest(BaseModel):
    messages: list[ChatMessage]


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


class AssistTurn(BaseModel):
    """One assistant response.

    When `type == "question"`, the assistant is asking for more info and
    `question` is set. When `type == "ready"`, the assistant has enough
    information and `scope` + `inferred` are populated.
    """

    type: Literal["question", "ready"]
    question: str | None = None
    scope: ScopeDraft | None = None
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


async def run_scope_assistant(messages: list[ChatMessage]) -> AssistTurn:
    """Run one chat turn against the scope assistant.

    Raises `ValueError` if `messages` does not end with a user message
    (the LLM should always be responding to a user, not appending to
    its own prior turn).
    """

    if not messages or messages[-1].role != "user":
        raise ValueError("conversation must end with a user message")

    client = _get_client()
    contents = _to_genai_contents(messages)
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
    return _scrub_caps(parsed)


def _scrub_caps(turn: AssistTurn) -> AssistTurn:
    """Force the numeric caps back to their defaults.

    The system prompt instructs the model never to set the cap fields, but
    structured-output models will often fill every field anyway with values
    they invent. Operators tune the caps explicitly later; the assistant
    must not steer them silently.
    """

    if turn.scope is None:
        return turn
    turn.scope.maxOrganizationsToDiscover = (
        ScopeDraft.model_fields["maxOrganizationsToDiscover"].default
    )
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
