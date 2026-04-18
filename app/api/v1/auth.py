"""Authentication and authorization endpoints for the API."""

import uuid

from typing import List

from fastapi import (
    APIRouter,
    Depends,
    Form,
    Header,
    HTTPException,
    Request,
)
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)
from google.auth import exceptions as google_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import (
    bind_context,
    logger,
)
from app.models.session import Session
from app.models.user import User
from app.schemas.auth import (
    GoogleLoginRequest,
    GoogleLoginResponse,
    GoogleLoginUser,
    SessionResponse,
)
from app.services.database import DatabaseService
from app.utils.auth import (
    create_access_token,
    verify_token,
)
from app.utils.sanitization import sanitize_string
from app.core.tutorial.content import (
    get_default_resume,
    get_tutorial_session_name,
    normalize_locale,
)

router = APIRouter()
security = HTTPBearer()
db_service = DatabaseService()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    """Get the current user from the access token."""
    try:
        token = sanitize_string(credentials.credentials)
        user_id = verify_token(token)
        if user_id is None:
            logger.error("invalid_token", token_part=token[:10] + "...")
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user_id_int = int(user_id)
        user = await db_service.get_user(user_id_int)
        if user is None:
            logger.error("user_not_found", user_id=user_id_int)
            raise HTTPException(
                status_code=404,
                detail="User not found",
                headers={"WWW-Authenticate": "Bearer"},
            )

        bind_context(user_id=user_id_int)
        return user
    except ValueError as ve:
        logger.error("token_validation_failed", error=str(ve), exc_info=True)
        raise HTTPException(
            status_code=422,
            detail="Invalid token format",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_session(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Session:
    """Get the current session from the session token."""
    try:
        token = sanitize_string(credentials.credentials)
        session_id = verify_token(token)
        if session_id is None:
            logger.error("session_id_not_found", token_part=token[:10] + "...")
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        session_id = sanitize_string(session_id)
        session = await db_service.get_session(session_id)
        if session is None:
            logger.error("session_not_found", session_id=session_id)
            raise HTTPException(
                status_code=404,
                detail="Session not found",
                headers={"WWW-Authenticate": "Bearer"},
            )

        bind_context(user_id=session.user_id)
        return session
    except ValueError as ve:
        logger.error("token_validation_failed", error=str(ve), exc_info=True)
        raise HTTPException(
            status_code=422,
            detail="Invalid token format",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("/google", response_model=GoogleLoginResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["login"][0])
async def google_login(request: Request, body: GoogleLoginRequest):
    """Authenticate via Google OAuth ID token.

    Verifies the Google ID token, upserts the user, and returns an access token.

    Args:
        request: The FastAPI request object for rate limiting.
        body: The Google login request containing the credential.

    Returns:
        GoogleLoginResponse: User info and access token.
    """
    try:
        idinfo = google_id_token.verify_oauth2_token(
            body.credential,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )

        google_id = idinfo["sub"]
        email = idinfo.get("email", "")
        name = idinfo.get("name", "")
        picture = idinfo.get("picture", "")

        user = await db_service.upsert_user_by_google_id(
            google_id=google_id,
            email=email,
            name=name,
            avatar_url=picture,
        )

        token = create_access_token(str(user.id))

        logger.info("google_login_success", user_id=user.id, google_id=google_id)

        return GoogleLoginResponse(
            user=GoogleLoginUser(
                id=user.id,
                email=user.email,
                name=user.name,
                avatar_url=user.avatar_url,
            ),
            token=token,
        )
    except (ValueError, google_exceptions.GoogleAuthError) as e:
        logger.error("google_token_verification_failed", error=str(e))
        raise HTTPException(status_code=401, detail="Invalid Google token")


@router.post("/session", response_model=SessionResponse)
async def create_session(user: User = Depends(get_current_user)):
    """Create a new chat session for the authenticated user."""
    try:
        session_id = str(uuid.uuid4())
        session = await db_service.create_session(session_id, user.id)
        token = create_access_token(session_id)

        logger.info(
            "session_created",
            session_id=session_id,
            user_id=user.id,
            name=session.name,
            expires_at=token.expires_at.isoformat(),
        )

        return SessionResponse(
            session_id=session_id, name=session.name, token=token, created_at=session.created_at
        )
    except ValueError as ve:
        logger.error("session_creation_validation_failed", error=str(ve), user_id=user.id, exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))


@router.patch("/session/{session_id}/name", response_model=SessionResponse)
async def update_session_name(
    session_id: str, name: str = Form(...), current_session: Session = Depends(get_current_session)
):
    """Update a session's name."""
    try:
        sanitized_session_id = sanitize_string(session_id)
        sanitized_name = sanitize_string(name)
        sanitized_current_session = sanitize_string(current_session.id)

        if sanitized_session_id != sanitized_current_session:
            raise HTTPException(status_code=403, detail="Cannot modify other sessions")

        session = await db_service.update_session_name(sanitized_session_id, sanitized_name)
        token = create_access_token(sanitized_session_id)

        return SessionResponse(
            session_id=sanitized_session_id, name=session.name, token=token, created_at=session.created_at
        )
    except ValueError as ve:
        logger.error("session_update_validation_failed", error=str(ve), session_id=session_id, exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))


@router.delete("/session/{session_id}")
async def delete_session(session_id: str, current_session: Session = Depends(get_current_session)):
    """Delete a session for the authenticated user."""
    try:
        sanitized_session_id = sanitize_string(session_id)
        sanitized_current_session = sanitize_string(current_session.id)

        if sanitized_session_id != sanitized_current_session:
            raise HTTPException(status_code=403, detail="Cannot delete other sessions")

        await db_service.delete_session(sanitized_session_id)
        logger.info("session_deleted", session_id=session_id, user_id=current_session.user_id)
    except ValueError as ve:
        logger.error("session_deletion_validation_failed", error=str(ve), session_id=session_id, exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))


@router.get("/sessions", response_model=List[SessionResponse])
async def get_user_sessions(
    user: User = Depends(get_current_user),
    accept_language: str | None = Header(default=None),
):
    """Get all session IDs for the authenticated user, auto-seeding the tutorial on first login."""
    try:
        sessions = await db_service.get_user_sessions(user.id)
        if not sessions:
            locale = normalize_locale(accept_language)
            await db_service.seed_tutorial_for_user(
                user_id=user.id,
                locale=locale,
                session_id=str(uuid.uuid4()),
                session_name=get_tutorial_session_name(locale),
                default_resume=get_default_resume(locale),
            )
            sessions = await db_service.get_user_sessions(user.id)
        return [
            SessionResponse(
                session_id=sanitize_string(session.id),
                name=sanitize_string(session.name),
                token=create_access_token(session.id),
                created_at=session.created_at,
                is_tutorial=session.is_tutorial,
            )
            for session in sessions
        ]
    except ValueError as ve:
        logger.error("get_sessions_validation_failed", user_id=user.id, error=str(ve), exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))
