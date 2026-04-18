"""This file contains the database service for the application."""

from datetime import UTC, datetime
from typing import (
    List,
    Optional,
)

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import QueuePool
from sqlmodel import (
    Session,
    SQLModel,
    create_engine,
    select,
)

from app.core.config import (
    Environment,
    settings,
)
from app.core.logging import logger
from app.models.session import Session as ChatSession
from app.models.user import User

# Import new models so SQLModel registers them before create_all
from app.models.application import Application  # noqa: F401
from app.models.job_listing import JobListing  # noqa: F401
from app.models.job_preference import JobPreference  # noqa: F401
from app.models.search_config import SearchConfig  # noqa: F401


class DatabaseService:
    """Service class for database operations.

    This class handles all database operations for Users, Sessions, and Messages.
    It uses SQLModel for ORM operations and maintains a connection pool.
    """

    def __init__(self):
        """Initialize database service with connection pool."""
        try:
            # Configure environment-specific database connection pool settings
            pool_size = settings.POSTGRES_POOL_SIZE
            max_overflow = settings.POSTGRES_MAX_OVERFLOW

            # Create engine with appropriate pool configuration
            connection_url = (
                f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
                f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
            )

            self.engine = create_engine(
                connection_url,
                pool_pre_ping=True,
                poolclass=QueuePool,
                pool_size=pool_size,
                max_overflow=max_overflow,
                pool_timeout=30,  # Connection timeout (seconds)
                pool_recycle=1800,  # Recycle connections after 30 minutes
            )

            # Create tables (only if they don't exist)
            SQLModel.metadata.create_all(self.engine)

            logger.info(
                "database_initialized",
                environment=settings.ENVIRONMENT.value,
                pool_size=pool_size,
                max_overflow=max_overflow,
            )
        except SQLAlchemyError as e:
            logger.error("database_initialization_error", error=str(e), environment=settings.ENVIRONMENT.value)
            # In production, don't raise - allow app to start even with DB issues
            if settings.ENVIRONMENT != Environment.PRODUCTION:
                raise

    async def upsert_user_by_google_id(
        self, google_id: str, email: str, name: str, avatar_url: str
    ) -> User:
        """Find user by google_id or create a new one. Updates name/avatar on each login.

        Args:
            google_id: Google account unique identifier
            email: User's email from Google
            name: User's display name from Google
            avatar_url: User's profile picture URL from Google

        Returns:
            User: The found or created user
        """
        with Session(self.engine) as session:
            statement = select(User).where(User.google_id == google_id)
            user = session.exec(statement).first()
            if user:
                user.email = email
                user.name = name
                user.avatar_url = avatar_url
                session.add(user)
                session.commit()
                session.refresh(user)
                logger.info("user_updated_on_login", user_id=user.id, google_id=google_id)
            else:
                user = User(
                    google_id=google_id, email=email, name=name, avatar_url=avatar_url
                )
                session.add(user)
                session.commit()
                session.refresh(user)
                logger.info("user_created", google_id=google_id, email=email)
            return user

    async def get_user(self, user_id: int) -> Optional[User]:
        """Get a user by ID.

        Args:
            user_id: The ID of the user to retrieve

        Returns:
            Optional[User]: The user if found, None otherwise
        """
        with Session(self.engine) as session:
            user = session.get(User, user_id)
            return user

    async def update_user_system_prompt(self, user_id: int, prompt: Optional[str]) -> User:
        """Set or clear a user's custom system prompt.

        Args:
            user_id: The ID of the user to update.
            prompt: The new system prompt, or None to reset to default.

        Returns:
            User: The updated user.

        Raises:
            HTTPException: If the user is not found.
        """
        with Session(self.engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            user.system_prompt = prompt
            session.add(user)
            session.commit()
            session.refresh(user)
            logger.info("user_system_prompt_updated", user_id=user_id, is_custom=prompt is not None)
            return user

    async def get_user_by_id(self, user_id: int) -> Optional[User]:
        """Fetch a user by primary key.

        Args:
            user_id: The user's primary key.

        Returns:
            Optional[User]: The user if found, None otherwise.
        """
        with Session(self.engine) as session:
            return session.get(User, user_id)

    async def update_user_resume(self, user_id: int, resume_text: Optional[str]) -> User:
        """Set or clear a user's resume text.

        Args:
            user_id: The ID of the user to update.
            resume_text: Plain-text resume, or None to clear.

        Returns:
            User: The updated user.

        Raises:
            HTTPException: If the user is not found.
        """
        with Session(self.engine) as session:
            user = session.get(User, user_id)
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            user.resume_text = resume_text
            session.add(user)
            session.commit()
            session.refresh(user)
            logger.info("user_resume_updated", user_id=user_id, has_resume=resume_text is not None)
            return user

    async def create_session(self, session_id: str, user_id: int, name: str = "") -> ChatSession:
        """Create a new chat session.

        Args:
            session_id: The ID for the new session
            user_id: The ID of the user who owns the session
            name: Optional name for the session (defaults to empty string)

        Returns:
            ChatSession: The created session
        """
        with Session(self.engine) as session:
            chat_session = ChatSession(id=session_id, user_id=user_id, name=name)
            session.add(chat_session)
            session.commit()
            session.refresh(chat_session)
            logger.info("session_created", session_id=session_id, user_id=user_id, name=name)
            return chat_session

    async def delete_session(self, session_id: str) -> bool:
        """Delete a session by ID.

        Args:
            session_id: The ID of the session to delete

        Returns:
            bool: True if deletion was successful, False if session not found
        """
        with Session(self.engine) as session:
            chat_session = session.get(ChatSession, session_id)
            if not chat_session:
                return False

            session.delete(chat_session)
            session.commit()
            logger.info("session_deleted", session_id=session_id)
            return True

    async def get_session(self, session_id: str) -> Optional[ChatSession]:
        """Get a session by ID.

        Args:
            session_id: The ID of the session to retrieve

        Returns:
            Optional[ChatSession]: The session if found, None otherwise
        """
        with Session(self.engine) as session:
            chat_session = session.get(ChatSession, session_id)
            return chat_session

    async def get_user_sessions(self, user_id: int) -> List[ChatSession]:
        """Get all sessions for a user.

        Args:
            user_id: The ID of the user

        Returns:
            List[ChatSession]: List of user's sessions
        """
        with Session(self.engine) as session:
            statement = select(ChatSession).where(ChatSession.user_id == user_id).order_by(ChatSession.created_at)
            sessions = session.exec(statement).all()
            return sessions

    async def update_session_name(self, session_id: str, name: str) -> ChatSession:
        """Update a session's name.

        Args:
            session_id: The ID of the session to update
            name: The new name for the session

        Returns:
            ChatSession: The updated session

        Raises:
            HTTPException: If session is not found
        """
        with Session(self.engine) as session:
            chat_session = session.get(ChatSession, session_id)
            if not chat_session:
                raise HTTPException(status_code=404, detail="Session not found")

            chat_session.name = name
            session.add(chat_session)
            session.commit()
            session.refresh(chat_session)
            logger.info("session_name_updated", session_id=session_id, name=name)
            return chat_session

    async def seed_tutorial_for_user(
        self,
        user_id: int,
        locale: str,
        session_id: str,
        session_name: str,
        default_resume: str,
    ) -> ChatSession:
        """Create the tutorial Session row + write the default resume.

        Idempotent: if a tutorial session already exists, return it unchanged.
        The default resume is written only when the user has no resume yet, or
        the stored resume is already flagged as default.
        """
        with Session(self.engine) as s:
            existing = s.exec(
                select(ChatSession).where(
                    ChatSession.user_id == user_id, ChatSession.is_tutorial.is_(True)
                )
            ).first()
            if existing is None:
                tutorial = ChatSession(
                    id=session_id,
                    user_id=user_id,
                    name=session_name,
                    is_tutorial=True,
                )
                s.add(tutorial)
            else:
                tutorial = existing

            user = s.exec(select(User).where(User.id == user_id)).first()
            if not user.resume_text or user.resume_is_default:
                user.resume_text = default_resume
                user.resume_is_default = True
            s.commit()
            s.refresh(tutorial)
            return tutorial

    async def get_tutorial_session_for_user(self, user_id: int) -> Optional[ChatSession]:
        """Return the tutorial session for a user, or None if it doesn't exist."""
        with Session(self.engine) as s:
            return s.exec(
                select(ChatSession).where(
                    ChatSession.user_id == user_id, ChatSession.is_tutorial.is_(True)
                )
            ).first()

    async def mark_tutorial_completed(self, user_id: int) -> None:
        """Set tutorial_completed_at to now for the given user."""
        with Session(self.engine) as s:
            user = s.exec(select(User).where(User.id == user_id)).first()
            user.tutorial_completed_at = datetime.now(UTC)
            s.commit()

    async def reset_tutorial_completion(self, user_id: int) -> None:
        """Clear tutorial_completed_at for the given user."""
        with Session(self.engine) as s:
            user = s.exec(select(User).where(User.id == user_id)).first()
            user.tutorial_completed_at = None
            s.commit()

    async def set_resume_is_default(self, user_id: int, value: bool) -> None:
        """Set or clear the resume_is_default flag for the given user."""
        with Session(self.engine) as s:
            user = s.exec(select(User).where(User.id == user_id)).first()
            user.resume_is_default = value
            s.commit()

    def get_session_maker(self):
        """Get a session maker for creating database sessions.

        Returns:
            Session: A SQLModel session maker
        """
        return Session(self.engine)

    async def health_check(self) -> bool:
        """Check database connection health.

        Returns:
            bool: True if database is healthy, False otherwise
        """
        try:
            with Session(self.engine) as session:
                # Execute a simple query to check connection
                session.exec(select(1)).first()
                return True
        except Exception as e:
            logger.error("database_health_check_failed", error=str(e))
            return False


# Create a singleton instance
database_service = DatabaseService()
