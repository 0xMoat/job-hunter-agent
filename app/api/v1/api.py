"""API v1 router configuration.

This module sets up the main API router and includes all sub-routers for different
endpoints like authentication and chatbot functionality.
"""

from fastapi import APIRouter

from app.api.v1.applications import router as applications_router
from app.api.v1.auth import router as auth_router
from app.api.v1.chatbot import router as chatbot_router
from app.api.v1.listings import router as listings_router
from app.api.v1.preferences import router as preferences_router
from app.api.v1.resume import router as resume_router
from app.api.v1.search import router as search_router
from app.api.v1.settings import router as settings_router
from app.api.v1.tutorial import router as tutorial_router
from app.core.logging import logger

api_router = APIRouter()

# Include routers
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(chatbot_router, prefix="/chatbot", tags=["chatbot"])
api_router.include_router(preferences_router, prefix="", tags=["job-preferences"])
api_router.include_router(listings_router, prefix="", tags=["job-listings"])
api_router.include_router(applications_router, prefix="", tags=["job-applications"])
api_router.include_router(settings_router, prefix="/settings", tags=["settings"])
api_router.include_router(tutorial_router, prefix="/tutorial", tags=["tutorial"])
api_router.include_router(search_router, prefix="/search", tags=["search"])
api_router.include_router(resume_router, prefix="/resume", tags=["resume"])


@api_router.get("/health")
async def health_check():
    """Health check endpoint.

    Returns:
        dict: Health status information.
    """
    logger.info("health_check_called")
    return {"status": "healthy", "version": "1.0.0"}
