"""FastAPI service — primary crawler for AhorrAR (Scrapling)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ahorrar_scraper.crawl import crawl

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ahorrar.scraper")

app = FastAPI(title="AhorrAR Scrapling crawler", version="0.1.0")


class CrawlRequest(BaseModel):
    product: str = Field(min_length=1, max_length=120)
    maxResults: int = Field(default=10, ge=1, le=30)
    maxNodes: int = Field(default=40, ge=1, le=200)
    maxDepth: int = Field(default=2, ge=0, le=4)
    includeMl: bool = False


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "engine": "scrapling", "primary": True}


@app.post("/crawl")
def crawl_endpoint(req: CrawlRequest) -> dict[str, Any]:
    product = req.product.strip()
    if not product:
        raise HTTPException(400, "product required")
    log.info(
        "crawl product=%r maxResults=%s includeMl=%s",
        product,
        req.maxResults,
        req.includeMl,
    )
    return crawl(
        product,
        max_results=req.maxResults,
        max_nodes=req.maxNodes,
        max_depth=req.maxDepth,
        include_ml=req.includeMl,
    )


@app.post("/crawl/stream")
async def crawl_stream(req: CrawlRequest) -> StreamingResponse:
    """ndjson stream: {"type":"offer",...} | {"type":"progress",...} | {"type":"done","summary":...} | {"type":"error",...}"""
    product = req.product.strip()
    if not product:
        raise HTTPException(400, "product required")
    log.info(
        "crawl/stream product=%r maxResults=%s includeMl=%s",
        product,
        req.maxResults,
        req.includeMl,
    )
    queue: asyncio.Queue = asyncio.Queue()

    def run() -> None:
        def emit(evt: dict[str, Any]) -> None:
            asyncio.run_coroutine_threadsafe(queue.put(evt), loop).result()

        try:
            import time

            started = time.time()
            summary = crawl(
                product,
                max_results=req.maxResults,
                max_nodes=req.maxNodes,
                max_depth=req.maxDepth,
                include_ml=req.includeMl,
                on_offer=lambda o: emit({"type": "offer", "offer": o}),
                on_progress=lambda **kw: emit({"type": "progress", **kw}),
            )
            summary["elapsedMs"] = int((time.time() - started) * 1000)
            emit({"type": "done", "summary": summary})
        except Exception as exc:  # noqa: BLE001
            log.exception("crawl/stream failed")
            emit({"type": "error", "message": str(exc)})
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(None), loop).result()

    loop = asyncio.get_running_loop()
    asyncio.get_event_loop().run_in_executor(None, run)

    async def gen():
        while True:
            evt = await queue.get()
            if evt is None:
                break
            yield json.dumps(evt, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


def main() -> None:
    host = os.environ.get("SCRAPER_HOST", "127.0.0.1")
    port = int(os.environ.get("SCRAPER_PORT", "4100"))
    uvicorn.run(
        "ahorrar_scraper.server:app",
        host=host,
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
