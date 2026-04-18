"""Locale-aware tutorial content loaders."""

from pathlib import Path
from typing import Literal

Locale = Literal["zh-CN", "en"]

_DIR = Path(__file__).parent


def get_default_resume(locale: Locale) -> str:
    """Return the default resume plain text for a given locale."""
    filename = "default_resume_zh.md" if locale == "zh-CN" else "default_resume_en.md"
    return (_DIR / filename).read_text(encoding="utf-8")


def get_tutorial_session_name(locale: Locale) -> str:
    """Return the sidebar display name for the tutorial session."""
    return "📘 使用引导教学" if locale == "zh-CN" else "📘 Tutorial"


def normalize_locale(raw: str | None) -> Locale:
    """Normalize the value from the client's Accept-Language or form payload."""
    if raw and raw.lower().startswith("zh"):
        return "zh-CN"
    return "en"
