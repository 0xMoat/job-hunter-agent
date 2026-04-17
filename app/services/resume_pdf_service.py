"""Service for generating resume PDFs from structured data."""

import re
import subprocess
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader
from jose import jwt
from markupsafe import Markup

from app.core.config import settings
from app.core.logging import logger
from app.schemas.resume import ResumeData

# Absolute path to venv python — use parent resolution but NOT resolve()
# on the final path, because .venv/bin/python is a symlink to system Python
# and resolve() would follow it, losing the venv site-packages.
_VENV_PYTHON = str(Path(__file__).resolve().parent.parent.parent / ".venv" / "bin" / "python")

_PDF_TOKEN_RE = re.compile(r"^resume_[a-f0-9]{12}$")


def _sign_download_url(pdf_path: Path) -> str:
    """Sign a 24h JWT for a PDF file path and return the download URL."""
    token_payload = {
        "file": str(pdf_path),
        "exp": datetime.now(UTC) + timedelta(hours=24),
    }
    token = jwt.encode(token_payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return f"/api/v1/resume/download/{token}"


def _bold_code_filter(text: str) -> Markup:
    """Convert **bold** and `code` markdown to HTML tags.

    Used as a Jinja2 filter for resume bullet points.
    """
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
    return Markup(text)


class ResumePDFService:
    """Renders structured resume data into a PDF via Jinja2 + weasyprint.

    weasyprint uses C libraries (Cairo/Pango) that conflict with uvicorn's
    event loop, causing infinite CPU spin. All rendering is done in a
    subprocess to isolate the C library state.
    """

    def __init__(self):
        """Initialize the Jinja2 environment with the templates directory."""
        template_dir = Path(__file__).parent.parent / "templates"
        self._env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=True,
        )
        self._env.filters["bold_code"] = _bold_code_filter

    def generate(self, data: ResumeData) -> str:
        """Generate a PDF and return a signed download URL.

        Args:
            data: Validated resume data.

        Returns:
            Download URL path (e.g. /api/v1/resume/download/{token}).
        """
        template = self._env.get_template("resume.html.j2")
        html = template.render(
            resume=data,
            generated_date=datetime.now().strftime("%Y.%m"),
        )

        filename = f"resume_{uuid.uuid4().hex[:12]}"
        html_path = Path("/tmp") / f"{filename}.html"
        pdf_path = Path("/tmp") / f"{filename}.pdf"

        html_path.write_text(html, encoding="utf-8")

        # Render in subprocess to avoid Cairo/Pango conflicts with uvicorn.
        # Use a minimal Python script instead of weasyprint CLI to bypass
        # macOS system proxy (system proxy affects CLI but not in-process calls
        # from a fresh Python process).
        result = subprocess.run(
            [_VENV_PYTHON, "-c",
             "import weasyprint,sys; weasyprint.HTML(filename=sys.argv[1]).write_pdf(sys.argv[2])",
             str(html_path), str(pdf_path)],
            capture_output=True,
            text=True,
            timeout=30,
        )

        html_path.unlink(missing_ok=True)

        if result.returncode != 0:
            logger.error("weasyprint_subprocess_failed", stderr=result.stderr[:500])
            raise RuntimeError(f"weasyprint failed: {result.stderr[:200]}")

        pdf_size = pdf_path.stat().st_size

        logger.info(
            "resume_pdf_generated",
            filepath=str(pdf_path),
            size_bytes=pdf_size,
        )

        return _sign_download_url(pdf_path)


def sign_pdf_download_url(pdf_token: str) -> Optional[str]:
    """Sign a fresh 24h JWT download URL for a stored PDF token.

    Returns None if the token is malformed or the underlying file no longer
    exists on disk (e.g., cleaned up after the 30-day retention cutoff).
    """
    if not _PDF_TOKEN_RE.match(pdf_token):
        return None
    pdf_path = Path("/tmp") / f"{pdf_token}.pdf"
    if not pdf_path.exists():
        return None
    return _sign_download_url(pdf_path)
