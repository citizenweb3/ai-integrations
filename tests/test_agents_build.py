from google.adk.tools.agent_tool import AgentTool

from src.ai.agents import build_agent, build_web_research_tool


def _tool_name(t) -> str:
    return getattr(t, "name", getattr(t, "__name__", t.__class__.__name__))


def test_web_research_is_agenttool():
    t = build_web_research_tool()
    assert isinstance(t, AgentTool)
    assert t.name == "web_research"


def test_build_agent_has_three_tools_incl_web_research():
    agent = build_agent("verification", model="gemini-3.5-flash", instruction="x")
    names = {_tool_name(t) for t in agent.tools}
    assert len(agent.tools) == 3
    assert "query_validatorinfo" in names
    assert "search_rag" in names
    assert "web_research" in names


def test_build_agent_carries_model_and_instruction():
    agent = build_agent("reply", model="gemini-3.1-pro-preview", instruction="be Aida")
    assert agent.model == "gemini-3.1-pro-preview"
    assert "be Aida" in agent.instruction
