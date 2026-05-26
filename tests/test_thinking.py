from src.ai.thinking import thinking_config


def test_off_disables_thinking():
    assert thinking_config("off").thinking_budget == 0
    assert thinking_config("min").thinking_budget == 0


def test_high_gives_more_budget_than_low():
    assert thinking_config("high").thinking_budget > thinking_config("low").thinking_budget


def test_unknown_effort_falls_back_to_medium():
    assert thinking_config("bogus").thinking_budget == thinking_config("medium").thinking_budget


def test_unknown_effort_warns(caplog):
    import logging
    with caplog.at_level(logging.WARNING):
        thinking_config("hihg")  # typo
    assert any("hihg" in r.getMessage() for r in caplog.records)
