"""Service layer for job-hunting domain: preferences, listings, applications."""

from datetime import UTC, datetime
from typing import List, Optional

from sqlalchemy import desc
from sqlmodel import Session, select

from app.core.logging import logger
from app.models.application import Application
from app.models.job_listing import JobListing
from app.models.job_preference import JobPreference
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

    # ── Applications ──────────────────────────────────────────────────────────

    async def add_application(
        self,
        user_id: int,
        company: str,
        title: str,
        url: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Application:
        """Record a new job application."""
        with Session(self._engine) as session:
            app = Application(
                user_id=user_id, company=company, title=title, url=url, notes=notes
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
        """List all applications for a user, newest first."""
        with Session(self._engine) as session:
            return list(
                session.exec(
                    select(Application)
                    .where(Application.user_id == user_id)
                    .order_by(desc(Application.applied_date))
                ).all()
            )

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


job_service = JobService()
