"""Resume PDF download endpoint."""

import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from jose import JWTError, jwt

from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger

router = APIRouter()


@router.get("/download/{token}")
@limiter.limit("5/minute")
async def download_resume_pdf(request: Request, token: str):
    """Download a generated resume PDF using a signed token.

    The token is self-contained (JWT) and expires after 10 minutes.
    No user authentication required — the token itself is the credential.
    """
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        logger.warning("resume_pdf_download_invalid_token")
        raise HTTPException(status_code=401, detail="Invalid or expired download link")

    filepath = payload.get("file", "")
    if not filepath.startswith("/tmp/resume_") or ".." in filepath:
        logger.warning("resume_pdf_download_path_traversal", filepath=filepath)
        raise HTTPException(status_code=403, detail="Invalid file path")

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found or expired")

    return FileResponse(
        filepath,
        media_type="application/pdf",
        filename="resume.pdf",
    )
