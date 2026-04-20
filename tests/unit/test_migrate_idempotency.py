"""Migration must be safely re-runnable. Reproduces the failure mode from
the 2026-04-18 session.created_at incident."""

import os

import psycopg2

from scripts import migrate


def _columns(table: str) -> set[str]:
    conn = psycopg2.connect(
        host=os.environ["POSTGRES_HOST"],
        port=os.environ["POSTGRES_PORT"],
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s",
                (table,),
            )
            return {row[0] for row in cur.fetchall()}
        finally:
            cur.close()
    finally:
        conn.close()


def test_migrate_run_is_idempotent(app):
    """Running migrate.run() twice must not raise and must leave schema unchanged."""
    # First run
    migrate.run()
    cols_after_first = _columns("applications")

    # Second run — must be a no-op, no DuplicateColumn errors
    migrate.run()
    cols_after_second = _columns("applications")

    assert cols_after_first == cols_after_second
    # Spot-check a few columns from the kanban migration
    assert "snippet" in cols_after_first
    assert "match_score" in cols_after_first
