# Google OAuth Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email/password auth with Google OAuth login using Google Identity Services (frontend) + `google-auth` library (backend ID token verification).

**Architecture:** Frontend loads Google Identity Services SDK on login page, handles One Tap + button flow, sends the Google `credential` (ID token JWT) to a new `POST /api/v1/auth/google` endpoint. Backend verifies the token with `google-auth`, upserts the user, and returns an access token. The existing session system (session tokens, chat, LangGraph) is untouched.

**Tech Stack:** `google-auth` (Python), Google Identity Services JS SDK, FastAPI, SQLModel, Next.js 16

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `pyproject.toml` | Add `google-auth`, remove `bcrypt` and `passlib[bcrypt]` |
| Modify | `app/core/config.py:164` | Add `GOOGLE_CLIENT_ID` setting |
| Modify | `app/models/user.py` | Replace `hashed_password` with `google_id`, `name`, `avatar_url`; remove bcrypt |
| Modify | `app/schemas/auth.py` | Replace `UserCreate`/`UserResponse` with `GoogleLoginRequest`/`GoogleLoginResponse`; remove password schemas |
| Modify | `app/services/database.py:78-95,109-121,183-200` | Replace `create_user(email,password)` with `upsert_user_by_google_id()`; remove `get_user_by_email`, `delete_user_by_email` |
| Modify | `app/api/v1/auth.py` | Replace `register`/`login` endpoints with `POST /auth/google`; remove password imports |
| Modify | `app/utils/sanitization.py:102-129` | Remove `validate_password_strength` |
| Modify | `scripts/migrate.py` | Add Google auth migration (clear users, alter columns) |
| Modify | `.env.example` | Add `GOOGLE_CLIENT_ID` placeholder |
| Modify | `.env.development` | Add `GOOGLE_CLIENT_ID` |
| Modify | `.env.production` | Add `GOOGLE_CLIENT_ID` |
| Modify | `frontend/lib/auth.ts` | Add `setUser`/`getUser`/`clearUser` for user profile storage |
| Modify | `frontend/lib/api.ts:40-69` | Replace `apiRegister`/`apiLogin` with `apiGoogleLogin` |
| Modify | `frontend/lib/i18n.ts` | Replace login form translations with Google login translations |
| Rewrite | `frontend/app/login/page.tsx` | Google One Tap + Sign In button |
| Modify | `frontend/app/chat/page.tsx:77-104` | Add user avatar + name display in navbar |

---

### Task 1: Update Python Dependencies

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Update pyproject.toml**

In `pyproject.toml`, replace `passlib[bcrypt]` and `bcrypt` with `google-auth`:

```toml
# Remove these two lines:
#     "passlib[bcrypt]>=1.7.4",
#     "bcrypt>=4.3.0",
# Add this line (alongside existing deps):
#     "google-auth>=2.38.0",
```

The exact edit: remove `"passlib[bcrypt]>=1.7.4",` and `"bcrypt>=4.3.0",` from the dependencies list, and add `"google-auth>=2.38.0",`.

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv sync`

Expected: Resolves successfully, `google-auth` installed, `bcrypt`/`passlib` removed.

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "chore: replace bcrypt/passlib with google-auth dependency"
```

---

### Task 2: Add GOOGLE_CLIENT_ID to Config

**Files:**
- Modify: `app/core/config.py:164`
- Modify: `.env.example`
- Modify: `.env.development`
- Modify: `.env.production`

- [ ] **Step 1: Add setting to config.py**

In `app/core/config.py`, after line 163 (`self.LONG_TERM_MEMORY_COLLECTION_NAME = ...`), before the `# JWT Configuration` comment, add:

```python
        # Google OAuth
        self.GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
```

- [ ] **Step 2: Add to .env.example**

Add after the JWT section:

```
# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
```

- [ ] **Step 3: Add placeholder to .env.development and .env.production**

Add to both files:

```
# Google OAuth
GOOGLE_CLIENT_ID=""
```

(Will be filled with actual value in the Google Cloud Console configuration task.)

- [ ] **Step 4: Commit**

```bash
git add app/core/config.py .env.example .env.development .env.production
git commit -m "feat: add GOOGLE_CLIENT_ID config setting"
```

---

### Task 3: Update User Model

**Files:**
- Modify: `app/models/user.py`

- [ ] **Step 1: Rewrite user.py**

Replace the entire content of `app/models/user.py` with:

```python
"""User model for the application."""

from typing import (
    TYPE_CHECKING,
    List,
    Optional,
)

from sqlmodel import (
    Field,
    Relationship,
)

from app.models.base import BaseModel

if TYPE_CHECKING:
    from app.models.session import Session


class User(BaseModel, table=True):
    """User model for storing user accounts via Google OAuth.

    Attributes:
        id: The primary key
        google_id: Google account unique identifier (sub claim)
        email: User's email from Google
        name: User's display name from Google
        avatar_url: User's profile picture URL from Google
        system_prompt: Custom system prompt override (None = use default)
        resume_text: User's resume text
        sessions: Relationship to user's chat sessions
    """

    id: int = Field(default=None, primary_key=True)
    google_id: str = Field(unique=True, index=True)
    email: str = Field(index=True)
    name: str = Field(default="")
    avatar_url: str = Field(default="")
    system_prompt: Optional[str] = Field(default=None)
    resume_text: Optional[str] = Field(default=None)
    sessions: List["Session"] = Relationship(back_populates="user")


# Avoid circular imports
from app.models.session import Session  # noqa: E402
```

- [ ] **Step 2: Verify import works**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent && python -c "from app.models.user import User; print('OK')"`

Expected: `OK` (no import errors)

- [ ] **Step 3: Commit**

```bash
git add app/models/user.py
git commit -m "feat: replace password fields with Google OAuth fields in User model"
```

---

### Task 4: Update Auth Schemas

**Files:**
- Modify: `app/schemas/auth.py`

- [ ] **Step 1: Rewrite auth.py**

Replace the entire content of `app/schemas/auth.py` with:

```python
"""Authentication schemas for the application."""

import re
from datetime import datetime
from typing import Optional

from pydantic import (
    BaseModel,
    Field,
)


class Token(BaseModel):
    """Token model for authentication."""

    access_token: str = Field(..., description="The JWT access token")
    token_type: str = Field(default="bearer", description="The type of token")
    expires_at: datetime = Field(..., description="The token expiration timestamp")


class GoogleLoginRequest(BaseModel):
    """Request model for Google OAuth login."""

    credential: str = Field(..., description="Google ID token JWT from frontend")


class GoogleLoginUser(BaseModel):
    """User info returned after Google login."""

    id: int
    email: str
    name: str
    avatar_url: str


class GoogleLoginResponse(BaseModel):
    """Response model for Google OAuth login."""

    user: GoogleLoginUser
    token: Token


class SessionResponse(BaseModel):
    """Response model for session creation."""

    session_id: str = Field(..., description="The unique identifier for the chat session")
    name: str = Field(default="", description="Name of the session", max_length=100)
    token: Token = Field(..., description="The authentication token for the session")
    created_at: Optional[datetime] = Field(default=None, description="When the session was created")

    @classmethod
    def sanitize_name(cls, v: str) -> str:
        """Sanitize the session name."""
        sanitized = re.sub(r'[<>{}[\]()\'"`]', "", v)
        return sanitized
```

- [ ] **Step 2: Verify import**

Run: `python -c "from app.schemas.auth import GoogleLoginRequest, GoogleLoginResponse, SessionResponse; print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add app/schemas/auth.py
git commit -m "feat: replace password auth schemas with Google OAuth schemas"
```

---

### Task 5: Update Database Service

**Files:**
- Modify: `app/services/database.py`

- [ ] **Step 1: Replace create_user with upsert_user_by_google_id**

In `app/services/database.py`, replace the `create_user` method (lines 78-94) with:

```python
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
```

- [ ] **Step 2: Remove get_user_by_email method**

Delete the `get_user_by_email` method (lines 109-121).

- [ ] **Step 3: Remove delete_user_by_email method**

Delete the `delete_user_by_email` method (lines 183-200).

- [ ] **Step 4: Commit**

```bash
git add app/services/database.py
git commit -m "feat: replace password-based user methods with Google OAuth upsert"
```

---

### Task 6: Update Auth Endpoints

**Files:**
- Modify: `app/api/v1/auth.py`

- [ ] **Step 1: Rewrite auth.py**

Replace the entire content of `app/api/v1/auth.py` with:

```python
"""Authentication and authorization endpoints for the API."""

import uuid

from typing import List

from fastapi import (
    APIRouter,
    Depends,
    Form,
    HTTPException,
    Request,
)
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)
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
    except ValueError as ve:
        logger.error("google_token_verification_failed", error=str(ve))
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
async def get_user_sessions(user: User = Depends(get_current_user)):
    """Get all session IDs for the authenticated user."""
    try:
        sessions = await db_service.get_user_sessions(user.id)
        return [
            SessionResponse(
                session_id=sanitize_string(session.id),
                name=sanitize_string(session.name),
                token=create_access_token(session.id),
                created_at=session.created_at,
            )
            for session in sessions
        ]
    except ValueError as ve:
        logger.error("get_sessions_validation_failed", user_id=user.id, error=str(ve), exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))
```

- [ ] **Step 2: Remove unused imports from sanitization.py**

In `app/utils/sanitization.py`, delete the `validate_password_strength` function (lines 102-129). Also remove `sanitize_email` (lines 39-55) since it's no longer used.

- [ ] **Step 3: Verify backend starts**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent && python -c "from app.api.v1.auth import router; print('OK')"`

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/auth.py app/utils/sanitization.py
git commit -m "feat: replace register/login endpoints with Google OAuth endpoint"
```

---

### Task 7: Update Database Migration Script

**Files:**
- Modify: `scripts/migrate.py`

- [ ] **Step 1: Add Google auth migration to migrate.py**

In `scripts/migrate.py`, add a new migration function after the existing `run()` function's `table_exists` check. Add this block inside the `try:` after the kanban migration code (after the `conn.commit()` on the existing migration):

Replace the entire `run()` function with:

```python
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
            ]
            for col, col_type in new_columns:
                if not column_exists(cur, "applications", col):
                    cur.execute(f"ALTER TABLE applications ADD COLUMN {col} {col_type}")  # noqa: S608
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

        # 3. Google OAuth migration on user table
        if table_exists(cur, "user"):
            # Add google_id column if missing
            if not column_exists(cur, "user", "google_id"):
                # Clear existing user data (foreign key cascade)
                cur.execute("DELETE FROM session")
                print("  Cleared session table for Google auth migration")
                cur.execute("DELETE FROM \"user\"")
                print("  Cleared user table for Google auth migration")

                # Drop hashed_password if it exists
                if column_exists(cur, "user", "hashed_password"):
                    cur.execute("ALTER TABLE \"user\" DROP COLUMN hashed_password")
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

        conn.commit()
        print("Migration completed successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        cur.close()
        conn.close()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/migrate.py
git commit -m "feat: add Google auth database migration (clear users, alter columns)"
```

---

### Task 8: Update Frontend Auth Helpers

**Files:**
- Modify: `frontend/lib/auth.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add user profile storage to auth.ts**

Replace the entire content of `frontend/lib/auth.ts` with:

```typescript
// localStorage helpers for token and user profile management.
// All reads guard against SSR with typeof window checks.

const ACCESS_TOKEN_KEY = "jh_access_token"
const SESSION_TOKEN_KEY = "jh_session_token"
const SESSION_ID_KEY = "jh_session_id"
const USER_KEY = "jh_user"

export interface UserProfile {
  id: number
  email: string
  name: string
  avatar_url: string
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function setAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token)
}

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(SESSION_TOKEN_KEY)
}

export function setSessionToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_KEY, token)
}

export function getSessionId(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(SESSION_ID_KEY)
}

export function setSessionId(id: string): void {
  localStorage.setItem(SESSION_ID_KEY, id)
}

export function getUser(): UserProfile | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UserProfile
  } catch {
    return null
  }
}

export function setUser(user: UserProfile): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearAuth(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(SESSION_TOKEN_KEY)
  localStorage.removeItem(SESSION_ID_KEY)
  localStorage.removeItem(USER_KEY)
}

export function isAuthenticated(): boolean {
  return !!getSessionToken()
}
```

- [ ] **Step 2: Replace register/login with googleLogin in api.ts**

In `frontend/lib/api.ts`, replace the entire `// ── Auth ──` section (lines 37-79) with:

```typescript
// ── Auth ──────────────────────────────────────────────────────────────────

export interface GoogleLoginResult {
  user: { id: number; email: string; name: string; avatar_url: string }
  token: { access_token: string; token_type: string; expires_at: string }
}

export async function apiGoogleLogin(
  credential: string,
): Promise<GoogleLoginResult> {
  const res = await req("/api/v1/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  })
  return res.json()
}

// Create a chat session with the access token.
// Returns {session_id, name, token: {access_token, ...}}
export async function apiCreateSession(
  accessToken: string,
): Promise<{ session_id: string; name: string; token: { access_token: string } }> {
  const res = await req("/api/v1/auth/session", { method: "POST" }, accessToken)
  return res.json()
}
```

- [ ] **Step 3: Remove apiRegister/apiLogin imports anywhere they're referenced**

The only import is in `frontend/app/login/page.tsx` which will be fully rewritten in the next task.

- [ ] **Step 4: Commit**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend
git add lib/auth.ts lib/api.ts
git commit -m "feat: replace register/login API with Google OAuth in frontend helpers"
```

---

### Task 9: Rewrite Login Page with Google Sign-In

**Files:**
- Rewrite: `frontend/app/login/page.tsx`
- Modify: `frontend/lib/i18n.ts`

- [ ] **Step 1: Update i18n translations**

In `frontend/lib/i18n.ts`, replace the login section in the `zh` dict (lines 96-106):

```typescript
  // Login
  login_title: 'Job Hunter',
  login_sub: '求职专属 AI 助手',
  login_loading: '登录中…',
  login_error: '登录失败，请重试',
```

And in the `en` dict (lines 201-212):

```typescript
  // Login
  login_title: 'Job Hunter',
  login_sub: 'AI-powered job hunting assistant',
  login_loading: 'Signing in…',
  login_error: 'Sign-in failed. Please try again.',
```

Remove all other `login_*` keys from both dicts (`login_mode_login`, `login_mode_register`, `login_email`, `login_password`, `login_pw_placeholder_new`, `login_pw_placeholder_existing`, `login_submit_login`, `login_submit_register`).

- [ ] **Step 2: Rewrite login page**

Replace the entire content of `frontend/app/login/page.tsx` with:

```tsx
"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { apiGoogleLogin, apiCreateSession } from "@/lib/api"
import {
  setAccessToken,
  setSessionToken,
  setSessionId,
  setUser,
  isAuthenticated,
} from "@/lib/auth"
import { useLanguage } from "@/contexts/LanguageContext"

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""

export default function LoginPage() {
  const router = useRouter()
  const { t, locale, setLocale } = useLanguage()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const googleBtnRef = useRef<HTMLDivElement>(null)

  // If already authenticated, redirect to chat
  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/chat")
    }
  }, [router])

  const handleCredential = useCallback(
    async (credential: string) => {
      setError("")
      setLoading(true)
      try {
        const data = await apiGoogleLogin(credential)
        setAccessToken(data.token.access_token)
        setUser(data.user)

        const session = await apiCreateSession(data.token.access_token)
        setSessionToken(session.token.access_token)
        setSessionId(session.session_id)
        router.push("/chat")
      } catch (err) {
        setError(err instanceof Error ? err.message : String(t("login_error")))
      } finally {
        setLoading(false)
      }
    },
    [router, t],
  )

  useEffect(() => {
    const script = document.createElement("script")
    script.src = "https://accounts.google.com/gsi/client"
    script.async = true
    script.onload = () => {
      const google = (window as any).google
      if (!google) return

      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response: any) => {
          handleCredential(response.credential)
        },
      })

      // Render the button
      if (googleBtnRef.current) {
        google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          width: "100%",
          text: "signin_with",
          shape: "pill",
        })
      }

      // Trigger One Tap
      google.accounts.id.prompt()
    }
    document.head.appendChild(script)

    return () => {
      script.remove()
    }
  }, [handleCredential])

  return (
    <div className="min-h-screen flex items-center justify-center">
      {/* Language toggle */}
      <button
        onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
        className="fixed top-4 right-4 text-xs font-body font-medium
                   text-[var(--text-3)] hover:text-[var(--text-2)]
                   px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
        aria-label="Switch language"
      >
        {t("lang_toggle")}
      </button>

      <div className="glass-strong rounded-3xl p-10 w-full max-w-md">
        <h1 className="font-heading italic text-3xl tracking-tight text-[var(--text)] mb-1">
          {t("login_title")}
        </h1>
        <p className="font-body font-light text-sm text-[var(--text-3)] mb-8">
          {t("login_sub")}
        </p>

        {error && (
          <p
            role="alert"
            className="text-red-600 text-sm bg-red-50 border border-red-200
                       rounded-xl px-4 py-2.5 font-body font-light mb-4"
          >
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-center text-sm font-body text-[var(--text-2)]">
            {t("login_loading")}
          </p>
        ) : (
          <div ref={googleBtnRef} className="flex justify-center" />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend
git add app/login/page.tsx lib/i18n.ts
git commit -m "feat: rewrite login page with Google One Tap + Sign In button"
```

---

### Task 10: Add User Avatar + Name to Chat Navbar

**Files:**
- Modify: `frontend/app/chat/page.tsx`

- [ ] **Step 1: Add user import and state**

In `frontend/app/chat/page.tsx`, add `getUser` to the import from `@/lib/auth` (line 5):

```typescript
import { isAuthenticated, clearAuth, getAccessToken, getUser } from "@/lib/auth"
```

- [ ] **Step 2: Add user state in ChatPageInner**

Inside `ChatPageInner()`, after the `const [kanbanRefreshKey, setKanbanRefreshKey]` line (line 27), add:

```typescript
  const user = getUser()
```

- [ ] **Step 3: Replace the logout button area in the navbar**

In the navbar's right section (lines 77-104), replace the logout button with user avatar + name + logout:

Find this block:

```tsx
            <button
              onClick={handleLogout}
              className="text-xs font-body text-[var(--text-3)] hover:text-[var(--text-2)]
                         px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
            >
              {t('logout')}
            </button>
```

Replace with:

```tsx
            {user?.avatar_url && (
              <img
                src={user.avatar_url}
                alt=""
                className="w-7 h-7 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            {user?.name && (
              <span className="text-xs font-body font-medium text-[var(--text-2)] max-w-[80px] truncate">
                {user.name}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="text-xs font-body text-[var(--text-3)] hover:text-[var(--text-2)]
                         px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
            >
              {t('logout')}
            </button>
```

- [ ] **Step 4: Commit**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend
git add app/chat/page.tsx
git commit -m "feat: show user avatar and name in chat navbar"
```

---

### Task 11: Configure Google Cloud Console OAuth Client

**Files:** None (external configuration)

- [ ] **Step 1: Create OAuth 2.0 Client ID in Google Cloud Console**

Use Claude in Chrome or manual browser to:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID (Web application type)
3. Set Authorized JavaScript origins:
   - `https://jobhunter.mintmind.io`
   - `http://localhost:3000`
4. Copy the generated Client ID

- [ ] **Step 2: Update environment files with Client ID**

Set `GOOGLE_CLIENT_ID` in:
- `.env.development`
- `.env.production`

- [ ] **Step 3: Set Vercel env var**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend
npx vercel env add NEXT_PUBLIC_GOOGLE_CLIENT_ID production
```

(Paste the Client ID when prompted)

- [ ] **Step 4: Commit env changes**

```bash
git add .env.development .env.production
git commit -m "chore: add Google OAuth Client ID to env files"
```

---

### Task 12: Deploy and Verify

**Files:** None (deployment)

- [ ] **Step 1: Push all changes**

```bash
git push
```

- [ ] **Step 2: Rebuild and deploy backend**

SSH into the server and rebuild:

```bash
ssh -i ~/.ssh/oracle-ssh-keys/ssh-key-2025-07-12.key ubuntu@137.131.22.123
cd /home/ubuntu/Job-Hunter-Agent
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

- [ ] **Step 3: Verify backend endpoint**

```bash
curl -s https://api.jobhunter.mintmind.io/health | jq .
```

Expected: `{"status": "healthy", ...}`

- [ ] **Step 4: Redeploy frontend on Vercel**

Either push triggers auto-deploy, or:

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend
npx vercel --prod
```

- [ ] **Step 5: End-to-end test**

1. Open https://jobhunter.mintmind.io
2. Should see Google One Tap popup or Sign In button
3. Click Sign In → Google OAuth flow → redirected to /chat
4. User avatar and name visible in navbar
5. Chat works normally
6. Logout → back to login page
