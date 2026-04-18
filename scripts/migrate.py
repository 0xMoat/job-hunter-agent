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
        WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    return cur.fetchone() is not None


def table_exists(cur, table: str) -> bool:
    cur.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    )
    return cur.fetchone() is not None


def run():
    conn = get_conn()
    conn.autocommit = False
    cur = conn.cursor()
    try:
        if not table_exists(cur, "applications"):
            print("Table 'applications' does not exist yet, skipping kanban migration.")
        else:
            # 1. Add new columns to applications table (idempotent)
            new_columns = [
                ("snippet",      "TEXT"),
                ("found_date",   "DATE"),
                ("source",       "TEXT NOT NULL DEFAULT 'manual'"),
                ("archived_at",  "TIMESTAMP WITH TIME ZONE"),
                ("match_score",  "INTEGER"),
                ("company_research_json",    "TEXT"),
                ("tailored_resume_text",     "TEXT"),
                ("pdf_token",               "VARCHAR(64)"),
                ("pdf_created_at",          "TIMESTAMP WITH TIME ZONE"),
                ("match_breakdown",         "TEXT"),
                ("gap_analysis_text",       "TEXT"),
                ("interview_questions_json", "TEXT"),
                ("artifacts_updated_at",    "TIMESTAMP WITH TIME ZONE"),
            ]
            for col, col_type in new_columns:
                if not column_exists(cur, "applications", col):
                    # col and col_type are compile-time constants from the hardcoded list above — not derived from any external input.
                    cur.execute(f"ALTER TABLE applications ADD COLUMN {col} {col_type}")  # noqa: S608
                    print(f"  Added column: applications.{col}")
                else:
                    print(f"  Column already exists: applications.{col}")

            # 2. Fix applied_date to be nullable (model defines it as Optional)
            cur.execute("ALTER TABLE applications ALTER COLUMN applied_date DROP NOT NULL")
            print("  Fixed: applied_date now nullable")

            # 3. Migrate legacy status values
            cur.execute(
                "UPDATE applications SET status = 'completed' WHERE status = 'offer'"
            )
            print(f"  Migrated 'offer' → 'completed': {cur.rowcount} rows")

            cur.execute(
                "UPDATE applications SET status = 'not_a_match' WHERE status = 'rejected'"
            )
            print(f"  Migrated 'rejected' → 'not_a_match': {cur.rowcount} rows")

        # 3. Google OAuth migration on user table
        if table_exists(cur, "user"):
            # Add google_id column if missing
            if not column_exists(cur, "user", "google_id"):
                # Clear existing user data (foreign key cascade)
                cur.execute("DELETE FROM session")
                print("  Cleared session table for Google auth migration")
                cur.execute('DELETE FROM "user"')
                print("  Cleared user table for Google auth migration")

                # Drop hashed_password if it exists
                if column_exists(cur, "user", "hashed_password"):
                    cur.execute('ALTER TABLE "user" DROP COLUMN hashed_password')
                    print("  Dropped column: user.hashed_password")

                # Add new columns
                cur.execute("ALTER TABLE \"user\" ADD COLUMN google_id TEXT NOT NULL DEFAULT ''")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_user_google_id ON \"user\" (google_id)")
                print("  Added column: user.google_id (unique)")

                if not column_exists(cur, "user", "name"):
                    cur.execute("ALTER TABLE \"user\" ADD COLUMN name TEXT NOT NULL DEFAULT ''")
                    print("  Added column: user.name")

                if not column_exists(cur, "user", "avatar_url"):
                    cur.execute("ALTER TABLE \"user\" ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
                    print("  Added column: user.avatar_url")
            else:
                print("  Google auth columns already exist on user table")

        # Onboarding tour migration ------------------------------------
        if table_exists(cur, "session"):
            if not column_exists(cur, "session", "is_tutorial"):
                cur.execute(
                    'ALTER TABLE session ADD COLUMN is_tutorial BOOLEAN NOT NULL DEFAULT FALSE'
                )
                print("  Added column: session.is_tutorial")
            if not column_exists(cur, "session", "created_at"):
                cur.execute(
                    'ALTER TABLE session ADD COLUMN created_at TIMESTAMP WITH TIME ZONE '
                    'NOT NULL DEFAULT NOW()'
                )
                print("  Added column: session.created_at")

        if table_exists(cur, "user"):
            if not column_exists(cur, "user", "resume_is_default"):
                cur.execute(
                    'ALTER TABLE "user" ADD COLUMN resume_is_default BOOLEAN NOT NULL DEFAULT FALSE'
                )
                print("  Added column: user.resume_is_default")
            if not column_exists(cur, "user", "tutorial_completed_at"):
                cur.execute(
                    'ALTER TABLE "user" ADD COLUMN tutorial_completed_at TIMESTAMP WITH TIME ZONE'
                )
                print("  Added column: user.tutorial_completed_at")

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
