"""Service for generating resume PDFs from structured data."""

import re
import subprocess
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

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
    """Renders structured resume data into a PDF via Jinja2 + weasyprint.

    weasyprint uses C libraries (Cairo, Pango) that deadlock when called
    inside uvicorn's uvloop event loop. To avoid this, rendering is done
    in a subprocess via a small helper script.
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

        # Write HTML to a temp file, then invoke weasyprint in a subprocess
        # to avoid Cairo/Pango deadlock under uvloop.
        filename = f"resume_{uuid.uuid4().hex[:12]}"
        html_path = Path("/tmp") / f"{filename}.html"
        pdf_path = Path("/tmp") / f"{filename}.pdf"

        html_path.write_text(html, encoding="utf-8")

        # Use weasyprint CLI from the venv to avoid uvloop deadlocks.
        weasyprint_bin = str(Path(__file__).parent.parent.parent / ".venv" / "bin" / "weasyprint")

        # Clean env: explicitly disable all proxies to prevent weasyprint
        # network timeouts when system proxy (e.g. 127.0.0.1:7890) is active.
        import os

        clean_env = dict(os.environ)
        for key in list(clean_env):
            if key.lower() in ("http_proxy", "https_proxy", "all_proxy", "no_proxy"):
                del clean_env[key]
        clean_env["no_proxy"] = "*"

        result = subprocess.run(
            [weasyprint_bin,
             "--timeout", "2",
             "--allowed-protocols", "file:",
             str(html_path), str(pdf_path)],
            capture_output=True,
            text=True,
            timeout=30,
            env=clean_env,
        )

        # Clean up temp HTML
        html_path.unlink(missing_ok=True)

        if result.returncode != 0:
            logger.error("weasyprint_subprocess_failed", stderr=result.stderr[:500])
            raise RuntimeError(f"weasyprint failed: {result.stderr[:200]}")

        pdf_size = pdf_path.stat().st_size

        token_payload = {
            "file": str(pdf_path),
            "exp": datetime.now(UTC) + timedelta(minutes=10),
        }
        token = jwt.encode(token_payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

        logger.info(
            "resume_pdf_generated",
            filepath=str(pdf_path),
            size_bytes=pdf_size,
        )

        return f"/api/v1/resume/download/{token}"
