import pytest

from src.ai.tools import is_safe_select


@pytest.mark.parametrize("sql", [
    "SELECT * FROM validators",
    "  select count(*) from votes  ",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "SELECT * FROM validators;",  # single trailing semicolon allowed
    # forbidden keywords as substrings of legit identifiers must NOT trip the guard
    "SELECT * FROM copy_of_validators",
    "SELECT * FROM update_log",
    "SELECT created_at FROM delete_history",
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
    # function-based side effects / DoS / table creation that keyword-only checks missed
    "SELECT pg_sleep(10)",
    "SELECT * INTO newtab FROM validators",
    "SELECT setval('s', 1)",
    "SELECT nextval('s')",
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT lo_export(1, '/tmp/x')",
])
def test_rejects_writes_and_multistatement(sql):
    assert is_safe_select(sql) is False
