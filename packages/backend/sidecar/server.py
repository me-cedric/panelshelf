"""
curl_cffi sidecar — lightweight Python service that uses curl_cffi's TLS
impersonation to bypass Cloudflare bot protection and fetch rendered HTML.

Usage (Docker):
    docker build -t panelshelf-curl-cffi -f Dockerfile .
    docker run -p 8192:8192 panelshelf-curl-cffi

API:
    POST /fetch
        {
            "url": "https://example.com",
            "impersonate": "chrome120",   // optional, default chrome120
            "max_timeout": 30000           // optional, ms, default 30000
        }
    Returns:
        {
            "success": true,
            "html": "<html>...</html>",
            "url": "https://example.com",
            "status_code": 200,
            "elapsed_ms": 1234
        }

    On failure:
        {
            "success": false,
            "error": "error message",
            "url": "https://example.com"
        }

    GET /health
        { "status": "ok" }
"""

import time
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

try:
    from curl_cffi.requests import Session, RequestsError
except ImportError:
    # Fallback for environments where curl_cffi is not installed (dev testing)
    from warnings import warn
    warn("curl_cffi not installed — using requests as fallback (will not bypass Cloudflare)")
    import requests as _requests
    from requests import RequestException as RequestsError

    class Session:
        def __init__(self, impersonate=None):
            self._impersonate = impersonate

        def get(self, url, **kwargs):
            return _requests.get(url, **kwargs)

        def close(self):
            pass


# ── Logging ──

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("curl-cffi-sidecar")

# ── App ──

app = FastAPI(
    title="curl_cffi Sidecar",
    description="Lightweight service that uses curl_cffi to bypass Cloudflare bot protection",
    version="0.1.0",
)


# ── Models ──

class FetchRequest(BaseModel):
    url: str
    impersonate: Optional[str] = "chrome120"
    max_timeout: Optional[int] = 30000  # ms


class FetchResponse(BaseModel):
    success: bool
    html: Optional[str] = None
    url: Optional[str] = None
    status_code: Optional[int] = None
    elapsed_ms: Optional[float] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str


# ── Endpoints ──

@app.get("/health", response_model=HealthResponse)
async def health():
    return {"status": "ok"}


@app.post("/fetch", response_model=FetchResponse)
async def fetch(request: FetchRequest):
    start = time.monotonic()
    url = request.url

    logger.info(f"Fetching: {url} (impersonate={request.impersonate}, timeout={request.max_timeout}ms)")

    session = Session(impersonate=request.impersonate)

    try:
        resp = session.get(
            url,
            timeout=min(request.max_timeout / 1000, 60),  # seconds
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Referer": "https://www.google.com/",
            },
            verify=False,  # skip SSL verification (some sites have cert issues)
        )

        elapsed = (time.monotonic() - start) * 1000
        html = resp.text

        # Detect Cloudflare challenge page
        is_blocked = (
            "Just a moment" in html
            or "cf-browser-verification" in html
            or "__cf_chl" in html
            or "cf-turnstile" in html
            or len(html) < 200
        )

        if is_blocked:
            logger.warning(f"Still blocked by Cloudflare after curl_cffi: {url} (status={resp.status_code}, len={len(html)})")
            return FetchResponse(
                success=False,
                error=f"Cloudflare challenge still present after curl_cffi fetch (status={resp.status_code})",
                url=url,
                status_code=resp.status_code,
                elapsed_ms=elapsed,
            )

        logger.info(f"Fetched: {url} (status={resp.status_code}, len={len(html)}, elapsed={elapsed:.0f}ms)")
        return FetchResponse(
            success=True,
            html=html,
            url=url,
            status_code=resp.status_code,
            elapsed_ms=elapsed,
        )

    except RequestsError as e:
        elapsed = (time.monotonic() - start) * 1000
        logger.error(f"Request failed: {url} — {e}")
        return FetchResponse(
            success=False,
            error=str(e),
            url=url,
            elapsed_ms=elapsed,
        )

    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        logger.error(f"Unexpected error: {url} — {e}")
        return FetchResponse(
            success=False,
            error=f"Unexpected error: {str(e)}",
            url=url,
            elapsed_ms=elapsed,
        )

    finally:
        session.close()


# ── Main ──

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8192,
        log_level="info",
    )
