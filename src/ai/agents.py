"""ADK agent factory for Aida's tool-using roles (reactive, reply, verification).

Web search is isolated in a `web_research` sub-agent (google_search only) attached
as an AgentTool. The parent agents therefore carry no built-in google_search, so the
built-in/custom-tool exclusivity constraint never triggers and the agents work on any
Gemini model. See docs/plans/2026-05-26-aida-vertex-adk-gemini-migration-design.md Topic 2.
"""

from __future__ import annotations

from google.adk import Agent
from google.adk.tools.agent_tool import AgentTool
from google.adk.tools import google_search
from google.genai import types

from .tools import query_validatorinfo, search_rag

# Search runs on the cheaper Flash tier (bizdev keeps grounded search off Pro).
_WEB_RESEARCH_MODEL = "gemini-3.5-flash"

_WEB_RESEARCH_INSTRUCTION = (
    "You are Aida's web research helper. Use google_search to find recent public "
    "information (governance updates, news, validator facts). Return a concise factual "
    "summary of what you found. Do NOT include URLs in the summary — the caller cannot "
    "send links. If nothing relevant is found, say so plainly."
)


def _static_instruction(text: str):
    """Wrap a fixed instruction as an ADK InstructionProvider so ADK does NOT treat
    it as a `{state}` template. Aida's CLAUDE.md contains literal `{...}` (JSON schema
    examples) that would otherwise raise KeyError during session-state injection."""
    def _provider(_ctx) -> str:
        return text
    return _provider


def build_web_research_tool() -> AgentTool:
    sub = Agent(
        model=_WEB_RESEARCH_MODEL,
        name="web_research",
        description="Search the public web for recent facts (returns a text summary, no URLs).",
        instruction=_WEB_RESEARCH_INSTRUCTION,
        tools=[google_search],
    )
    return AgentTool(agent=sub)


def build_agent(
    role: str,
    *,
    model: str,
    instruction: str,
    generate_content_config: "types.GenerateContentConfig | None" = None,
) -> Agent:
    """Build a tool-using agent for `role` (reactive | reply | verification)."""
    return Agent(
        model=model,
        name=f"aida_{role}",
        instruction=_static_instruction(instruction),
        tools=[query_validatorinfo, search_rag, build_web_research_tool()],
        generate_content_config=generate_content_config,
    )
