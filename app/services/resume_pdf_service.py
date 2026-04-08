"""Service for generating resume PDFs from structured data."""

import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import weasyprint
from jinja2 import Environment, FileSystemLoader
from jose import jwt
from markupsafe import Markup

from app.core.config import settings
from app.core.logging import logger
from app.schemas.resume import ResumeData


def _bold_code_filter(text: str) -> Markup:
    """Convert **bold** and `code` markdown to HTML tags.

    Used as a Jinja2 filter for resume bullet points.
    """
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
    return Markup(text)


class ResumePDFService:
    """Renders structured resume data into a PDF via Jinja2 + weasyprint."""

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

        pdf_bytes = weasyprint.HTML(string=html).write_pdf()

        filename = f"resume_{uuid.uuid4().hex[:12]}.pdf"
        filepath = Path("/tmp") / filename
        filepath.write_bytes(pdf_bytes)

        token_payload = {
            "file": str(filepath),
            "exp": datetime.now(UTC) + timedelta(minutes=10),
        }
        token = jwt.encode(token_payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

        logger.info(
            "resume_pdf_generated",
            filepath=str(filepath),
            size_bytes=len(pdf_bytes),
        )

        return f"/api/v1/resume/download/{token}"
