import pytest

from src.ai.tools import is_safe_select


@pytest.mark.parametrize("sql", [
    "SELECT * FROM validators",
    "  select count(*) from votes  ",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "SELECT * FROM validators;",  # single trailing semicolon allowed
])
def test_allows_readonly(sql):
    assert is_safe_select(sql) is True


@pytest.mark.parametrize("sql", [
    "DELETE FROM validators",
    "SELECT 1; DROP TABLE t",
    "UPDATE v SET x=1",
    "INSERT INTO t VALUES (1)",
    "SELECT * FROM t; --",
    "SELECT * FROM t /* c */",
    "TRUNCATE t",
    "GRANT ALL ON t TO public",
    "",
    "   ",
])
def test_rejects_writes_and_multistatement(sql):
    assert is_safe_select(sql) is False
