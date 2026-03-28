"""Idempotent database migration for tracking kanban feature.

Run before app startup. Safe to execute multiple times.
"""

import os
import sys

import psycopg2


def get_conn():
    return psycopg2.connect(
        host=os.environ["POSTGRES_HOST"],
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )


def column_exists(cur, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    return cur.fetchone() is not None


def run():
    conn = get_conn()
    conn.autocommit = False
    cur = conn.cursor()
    try:
        # 1. Add new columns to applications table (idempotent)
        new_columns = [
            ("snippet",      "TEXT"),
            ("found_date",   "DATE"),
            ("source",       "TEXT NOT NULL DEFAULT 'manual'"),
            ("archived_at",  "TIMESTAMP WITH TIME ZONE"),
        ]
        for col, col_type in new_columns:
            if not column_exists(cur, "applications", col):
                cur.execute(f"ALTER TABLE applications ADD COLUMN {col} {col_type}")
                print(f"  Added column: applications.{col}")
            else:
                print(f"  Column already exists: applications.{col}")

        # 2. Migrate legacy status values
        cur.execute(
            "UPDATE applications SET status = 'completed' WHERE status = 'offer'"
        )
        print(f"  Migrated 'offer' → 'completed': {cur.rowcount} rows")

        cur.execute(
            "UPDATE applications SET status = 'not_a_match' WHERE status = 'rejected'"
        )
        print(f"  Migrated 'rejected' → 'not_a_match': {cur.rowcount} rows")

        conn.commit()
        print("Migration completed successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run()
