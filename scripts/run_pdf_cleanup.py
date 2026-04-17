"""Manually trigger the PDF cleanup. Useful for smoke-testing."""

import asyncio

from app.core.pdf_cleanup import cleanup_expired_pdfs


if __name__ == "__main__":
    result = asyncio.run(cleanup_expired_pdfs())
    print(f"PDF cleanup result: {result}")
