"""Service layer for job-hunting domain: preferences, listings, applications."""

from datetime import UTC, date, datetime, timedelta
from typing import List, Optional

from sqlalchemy import desc
from sqlalchemy import func
from sqlmodel import Session, select

from app.core.logging import logger
from app.models.application import Application
from app.models.job_listing import JobListing
from app.models.job_preference import JobPreference
from app.models.search_config import SearchConfig
from app.services.database import database_service


class JobService:
    """Handles all persistence for the job-hunting domain.

    Reuses DatabaseService engine — no additional connection pool.
    Methods are async def for FastAPI compatibility; internals are sync SQLAlchemy
    (same pattern as DatabaseService).
    """

    @property
    def _engine(self):
        """Reuse the existing DatabaseService engine."""
        return database_service.engine

    # ── Preferences ──────────────────────────────────────────────────────────

    async def upsert_preference(
        self, user_id: int, keywords: str, location: str, job_type: str
    ) -> JobPreference:
        """Create or update job search preference for a user."""
        with Session(self._engine) as session:
            existing = session.exec(
                select(JobPreference).where(JobPreference.user_id == user_id)
            ).first()

            if existing:
                existing.keywords = keywords
                existing.location = location
                existing.job_type = job_type
                existing.updated_at = datetime.now(UTC)
                session.add(existing)
                session.commit()
                session.refresh(existing)
                logger.info("job_preference_updated", user_id=user_id)
                return existing

            pref = JobPreference(
                user_id=user_id, keywords=keywords, location=location, job_type=job_type
            )
            session.add(pref)
            session.commit()
            session.refresh(pref)
            logger.info("job_preference_created", user_id=user_id)
            return pref

    async def get_preference(self, user_id: int) -> Optional[JobPreference]:
        """Get job search preference for a user."""
        with Session(self._engine) as session:
            return session.exec(
                select(JobPreference).where(JobPreference.user_id == user_id)
            ).first()

    async def get_all_preferences(self) -> List[JobPreference]:
        """Get all users' preferences (used by daily scheduler).

        Note: loads all records — suitable for demo scale only.
        Production use requires pagination or active-user filtering.
        """
        with Session(self._engine) as session:
            return list(session.exec(select(JobPreference)).all())

    # ── Listings ──────────────────────────────────────────────────────────────

    async def upsert_listings(self, user_id: int, listings: List[dict]) -> int:
        """Insert new listings, skip duplicates (user_id + url). Returns count inserted."""
        inserted = 0
        with Session(self._engine) as session:
            for item in listings:
                url = item.get("url", "")
                if not url:
                    continue  # skip entries without a URL — no meaningful dedup key
                exists = session.exec(
                    select(JobListing).where(
                        JobListing.user_id == user_id,
                        JobListing.url == url,
                    )
                ).first()
                if not exists:
                    listing = JobListing(
                        user_id=user_id,
                        title=item.get("title", ""),
                        company=item.get("company", ""),
                        location=item.get("location", ""),
                        url=url,
                        snippet=item.get("snippet", ""),
                    )
                    session.add(listing)
                    inserted += 1
            session.commit()
        logger.info("listings_upserted", user_id=user_id, inserted=inserted)
        return inserted

    async def get_listings(self, user_id: int, limit: int = 50) -> List[JobListing]:
        """Get most recent job listings for a user."""
        with Session(self._engine) as session:
            return list(
                session.exec(
                    select(JobListing)
                    .where(JobListing.user_id == user_id)
                    .order_by(desc(JobListing.found_date))
                    .limit(limit)
                ).all()
            )

    async def batch_create_pending(
        self, user_id: int, listings: List[dict]
    ) -> dict:
        """Create pending kanban cards from scheduler results.

        Skips listings that already have an Application record (by user_id + url).
        Returns {"inserted": N, "skipped": M}.
        """
        inserted = 0
        skipped = 0
        with Session(self._engine) as session:
            for item in listings:
                url = item.get("url", "")
                if not url:
                    skipped += 1
                    continue
                exists = session.exec(
                    select(Application).where(
                        Application.user_id == user_id,
                        Application.url == url,
                    )
                ).first()
                if exists:
                    skipped += 1
                    continue
                found_date_raw = item.get("found_date")
                if isinstance(found_date_raw, str):
                    found_date_val = date.fromisoformat(found_date_raw)
                elif isinstance(found_date_raw, date):
                    found_date_val = found_date_raw
                else:
                    found_date_val = datetime.now(UTC).date()
                card = Application(
                    user_id=user_id,
                    title=item.get("title", ""),
                    company=item.get("company", ""),
                    url=url,
                    snippet=item.get("snippet", ""),
                    found_date=found_date_val,
                    source=item.get("source", "scheduler"),
                    status="pending",
                    match_score=item.get("match_score"),
                )
                session.add(card)
                inserted += 1
            session.commit()
        logger.info(
            "pending_cards_created",
            user_id=user_id,
            inserted=inserted,
            skipped=skipped,
        )
        return {"inserted": inserted, "skipped": skipped}

    async def archive_stale_pending(self, days: int = 7) -> int:
        """Set archived_at on scheduler-sourced pending cards older than `days`.

        Only affects cards where source='scheduler' and status='pending'.
        Manual pending cards are never auto-archived.
        Returns count of archived records.
        """
        cutoff = datetime.now(UTC).date() - timedelta(days=days)
        count = 0
        with Session(self._engine) as session:
            stale = session.exec(
                select(Application).where(
                    Application.status == "pending",
                    Application.source == "scheduler",
                    Application.found_date < cutoff,
                    Application.archived_at.is_(None),
                )
            ).all()
            for card in stale:
                card.archived_at = datetime.now(UTC)
                session.add(card)
                count += 1
            session.commit()
        logger.info("stale_pending_archived", count=count, cutoff=cutoff)
        return count

    # ── Applications ──────────────────────────────────────────────────────────

    async def add_application(
        self,
        user_id: int,
        company: str,
        title: str,
        url: Optional[str] = None,
        notes: Optional[str] = None,
        status: str = "pending",
    ) -> Application:
        """Create a new application card for manual tracking."""
        with Session(self._engine) as session:
            app = Application(
                user_id=user_id,
                company=company,
                title=title,
                url=url,
                notes=notes,
                source="manual",
                status=status,
            )
            session.add(app)
            session.commit()
            session.refresh(app)
            logger.info("application_added", user_id=user_id, company=company)
            return app

    async def update_application(
        self,
        application_id: int,
        user_id: int,
        status: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Optional[Application]:
        """Update application status or notes."""
        with Session(self._engine) as session:
            app = session.exec(
                select(Application).where(
                    Application.id == application_id,
                    Application.user_id == user_id,
                )
            ).first()
            if not app:
                return None
            if status:
                app.status = status
            if notes is not None:
                app.notes = notes
            app.updated_at = datetime.now(UTC)
            session.add(app)
            session.commit()
            session.refresh(app)
            logger.info("application_updated", application_id=application_id, user_id=user_id)
            return app

    async def list_applications(self, user_id: int) -> List[Application]:
        """List all active (non-archived) applications for a user, newest first."""
        with Session(self._engine) as session:
            return list(
                session.exec(
                    select(Application)
                    .where(Application.user_id == user_id)
                    .where(Application.archived_at.is_(None))
                    .order_by(desc(Application.updated_at))
                ).all()
            )

    async def count_archived_pending(self, user_id: int) -> int:
        """Count scheduler-sourced pending cards that have been archived for this user."""
        with Session(self._engine) as session:
            count = session.exec(
                select(func.count()).select_from(Application).where(
                    Application.user_id == user_id,
                    Application.status == "pending",
                    Application.source == "scheduler",
                    Application.archived_at.is_not(None),
                )
            ).one()
            return count

    async def delete_application(self, application_id: int, user_id: int) -> bool:
        """Delete an application. Returns True if deleted."""
        with Session(self._engine) as session:
            app = session.exec(
                select(Application).where(
                    Application.id == application_id,
                    Application.user_id == user_id,
                )
            ).first()
            if not app:
                return False
            session.delete(app)
            session.commit()
            logger.info("application_deleted", application_id=application_id, user_id=user_id)
            return True

    async def upsert_search_config(
        self,
        user_id: int,
        target_sites: str,
        schedule_enabled: bool,
        schedule_cron: str,
    ) -> SearchConfig:
        """Create or update the search config for a user."""
        with Session(self._engine) as session:
            existing = session.exec(
                select(SearchConfig).where(SearchConfig.user_id == user_id)
            ).first()
            if existing:
                existing.target_sites = target_sites
                existing.schedule_enabled = schedule_enabled
                existing.schedule_cron = schedule_cron
                existing.updated_at = datetime.now(UTC)
                session.add(existing)
                session.commit()
                session.refresh(existing)
                return existing
            config = SearchConfig(
                user_id=user_id,
                target_sites=target_sites,
                schedule_enabled=schedule_enabled,
                schedule_cron=schedule_cron,
            )
            session.add(config)
            session.commit()
            session.refresh(config)
            return config

    async def get_search_config(self, user_id: int) -> Optional[SearchConfig]:
        """Return the search config for a user, or None if not yet created."""
        with Session(self._engine) as session:
            return session.exec(
                select(SearchConfig).where(SearchConfig.user_id == user_id)
            ).first()

    async def get_all_search_configs(self) -> List[SearchConfig]:
        """Return all search configs with schedule_enabled=True."""
        with Session(self._engine) as session:
            return list(
                session.exec(
                    select(SearchConfig).where(SearchConfig.schedule_enabled == True)  # noqa: E712
                ).all()
            )


job_service = JobService()
