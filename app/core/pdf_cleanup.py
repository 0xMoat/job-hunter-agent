"""Daily cleanup of expired resume PDFs from /tmp and their card references."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.core.logging import logger
from app.services.job_service import job_service

_TMP_DIR = Path("/tmp")
_RETENTION_DAYS = 30


async def cleanup_expired_pdfs() -> dict[str, int]:
    """Delete resume_*.pdf older than 30 days; clear matching DB pdf_token.

    Returns:
        {"deleted_files": N, "cleared_rows": M}
    """
    cutoff = datetime.now(UTC) - timedelta(days=_RETENTION_DAYS)
    cutoff_ts = cutoff.timestamp()

    deleted_files = 0
    for pdf_path in _TMP_DIR.glob("resume_*.pdf"):
        try:
            if pdf_path.stat().st_mtime < cutoff_ts:
                pdf_path.unlink(missing_ok=True)
                deleted_files += 1
        except OSError as e:
            logger.warning("pdf_cleanup_file_skipped", path=str(pdf_path), error=str(e))

    cleared_rows = await job_service.clear_expired_pdf_tokens(cutoff)

    logger.info(
        "pdf_cleanup_done",
        deleted_files=deleted_files,
        cleared_rows=cleared_rows,
        cutoff=cutoff.isoformat(),
    )
    return {"deleted_files": deleted_files, "cleared_rows": cleared_rows}
