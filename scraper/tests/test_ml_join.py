"""ML join deadline — crawl must not wait 90s for a slow MLA worker (§T61)."""

from __future__ import annotations

import os
import threading
import time
import unittest
from concurrent.futures import Future
from unittest.mock import MagicMock, patch

from ahorrar_scraper import meli_api
from ahorrar_scraper.crawl import crawl, ml_join_timeout_s


class MlJoinTimeoutTest(unittest.TestCase):
    def test_default_is_short(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ML_JOIN_TIMEOUT_S", None)
            self.assertEqual(ml_join_timeout_s(), 4.0)

    def test_env_override(self) -> None:
        with patch.dict(os.environ, {"ML_JOIN_TIMEOUT_S": "2.5"}):
            self.assertEqual(ml_join_timeout_s(), 2.5)

    def test_future_timeout_does_not_block_long(self) -> None:
        """Sanity: Future.result(timeout=N) raises within ~N seconds."""
        fut: Future[list[object]] = Future()
        with self.assertRaises(TimeoutError):
            fut.result(timeout=0.2)

    def test_search_mla_respects_stop_event(self) -> None:
        """stop_event set → no N+1 submits; returns [] (late discard policy)."""
        stop = threading.Event()
        stop.set()
        with patch.object(meli_api, "meli_token_configured", return_value=True):
            with patch.object(meli_api._ml_circuit, "is_open", return_value=False):
                out = meli_api.search_mla("zapatillas", limit=5, stop_event=stop)
        self.assertEqual(out, [])

    def test_search_mla_stops_n_plus_one_when_cancelled(self) -> None:
        """After products/search, stop_event aborts before resolving products."""
        stop = threading.Event()
        search_res = MagicMock()
        search_res.status_code = 200
        search_res.json.return_value = {
            "results": [
                {"id": f"MLA{i}", "catalog_product_id": f"MLA{i}"} for i in range(5)
            ]
        }

        class _FakeClient:
            is_closed = False

            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            def get(self, *args: object, **kwargs: object) -> MagicMock:
                stop.set()
                return search_res

            def close(self) -> None:
                self.is_closed = True

        resolve = MagicMock(return_value={"url": "https://x", "name": "x"})
        with patch.object(meli_api, "meli_token_configured", return_value=True):
            with patch.object(meli_api._ml_circuit, "is_open", return_value=False):
                with patch.object(meli_api, "auth_headers", return_value={}):
                    with patch.object(meli_api.httpx, "Client", _FakeClient):
                        with patch.object(meli_api, "_resolve_product", resolve):
                            with patch.object(
                                meli_api, "_register_client", side_effect=lambda c: c
                            ):
                                with patch.object(meli_api, "_unregister_client"):
                                    out = meli_api.search_mla(
                                        "iphone", limit=5, stop_event=stop
                                    )
        self.assertEqual(out, [])
        resolve.assert_not_called()

    def test_abort_ml_http_closes_clients(self) -> None:
        client = MagicMock()
        with meli_api._clients_lock:
            meli_api._active_clients.append(client)
        meli_api.abort_ml_http()
        client.close.assert_called()
        with meli_api._clients_lock:
            self.assertEqual(meli_api._active_clients, [])

    def test_request_timeout_default_above_join(self) -> None:
        """ML_REQUEST_TIMEOUT_S must exceed join so slow MLA ≠ breaker trips."""
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ML_REQUEST_TIMEOUT_S", None)
            os.environ.pop("ML_TIMEOUT_S", None)
            # Re-read module defaults are fixed at import; assert current defaults.
            self.assertGreaterEqual(meli_api.ML_REQUEST_TIMEOUT_S, 8.0)
            self.assertGreater(meli_api.ML_REQUEST_TIMEOUT_S, ml_join_timeout_s())

    def test_network_timeout_without_cancel_trips_breaker(self) -> None:
        """Plain ReadTimeout (no stop_event) still counts under §V26."""
        breaker = meli_api._CircuitBreaker(2, 60.0)
        before = breaker.failure_count

        class _TimeoutClient:
            is_closed = False

            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            def get(self, *args: object, **kwargs: object) -> MagicMock:
                raise meli_api.httpx.ReadTimeout("slow")

            def close(self) -> None:
                self.is_closed = True

        with patch.object(meli_api, "meli_token_configured", return_value=True):
            with patch.object(meli_api, "_ml_circuit", breaker):
                with patch.object(meli_api, "auth_headers", return_value={}):
                    with patch.object(meli_api.httpx, "Client", _TimeoutClient):
                        with patch.object(
                            meli_api, "_register_client", side_effect=lambda c: c
                        ):
                            with patch.object(meli_api, "_unregister_client"):
                                out = meli_api.search_mla("iphone", limit=2)
        self.assertEqual(out, [])
        self.assertEqual(breaker.failure_count, before + 1)

    def test_network_timeout_with_cancel_skips_breaker(self) -> None:
        """Timeout after stop_event must not move the circuit (§T61 cancel path)."""
        breaker = meli_api._CircuitBreaker(2, 60.0)
        stop = threading.Event()

        class _TimeoutThenCancelClient:
            is_closed = False

            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            def get(self, *args: object, **kwargs: object) -> MagicMock:
                stop.set()
                raise meli_api.httpx.ReadTimeout("aborted")

            def close(self) -> None:
                self.is_closed = True

        before = breaker.failure_count
        with patch.object(meli_api, "meli_token_configured", return_value=True):
            with patch.object(meli_api, "_ml_circuit", breaker):
                with patch.object(meli_api, "auth_headers", return_value={}):
                    with patch.object(meli_api.httpx, "Client", _TimeoutThenCancelClient):
                        with patch.object(
                            meli_api, "_register_client", side_effect=lambda c: c
                        ):
                            with patch.object(meli_api, "_unregister_client"):
                                out = meli_api.search_mla(
                                    "iphone", limit=2, stop_event=stop
                                )
        self.assertEqual(out, [])
        self.assertEqual(breaker.failure_count, before)

    def test_crawl_join_timeout_no_new_calls_no_breaker(self) -> None:
        """Slow ML mock: wall ≈ ML_JOIN_TIMEOUT_S; no calls after cancel; breaker flat.

        Proves cooperative cancel (Event + no new work) — not Future.cancel alone.
        In-flight may still finish; result is discarded. Circuit must not move.
        """
        join_s = 0.4
        call_times: list[float] = []
        cancel_at: list[float] = []
        lock = threading.Lock()

        def slow_ml(
            query: str,
            *,
            limit: int = 20,
            stop_event: threading.Event | None = None,
        ) -> list[dict[str, object]]:
            # Simulate N+1 slots: check Event between "calls" (cooperative cancel).
            for i in range(40):
                if stop_event is not None and stop_event.is_set():
                    with lock:
                        cancel_at.append(time.monotonic())
                    meli_api._set_cancelled_calls(40 - i)
                    return []
                with lock:
                    call_times.append(time.monotonic())
                # Short sleep so we notice stop soon after join abandon.
                for _ in range(5):
                    if stop_event is not None and stop_event.is_set():
                        with lock:
                            cancel_at.append(time.monotonic())
                        meli_api._set_cancelled_calls(40 - i)
                        return []
                    time.sleep(0.03)
            return []

        breaker = meli_api._CircuitBreaker(3, 60.0)
        failures_before = breaker.failure_count
        t0 = time.monotonic()
        with patch.dict(
            os.environ,
            {"ML_JOIN_TIMEOUT_S": str(join_s), "CRAWL_DEADLINE_S": "5"},
            clear=False,
        ):
            with patch("ahorrar_scraper.crawl.meli_token_configured", return_value=True):
                with patch("ahorrar_scraper.crawl.search_mla", side_effect=slow_ml):
                    with patch("ahorrar_scraper.crawl.build_seed_urls", return_value=[]):
                        with patch.object(meli_api, "_ml_circuit", breaker):
                            with patch(
                                "ahorrar_scraper.crawl.abort_ml_http"
                            ) as abort_mock:
                                result = crawl(
                                    "zapatillas nike",
                                    max_results=5,
                                    max_nodes=1,
                                    max_depth=0,
                                    include_ml=True,
                                )
        elapsed = time.monotonic() - t0

        # Wall near join timeout (BFS empty → almost pure ML wait), not 90s.
        self.assertLess(elapsed, join_s + 1.5)
        self.assertGreaterEqual(elapsed, join_s * 0.7)

        # Worker observes stop asynchronously — wait briefly.
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            with lock:
                if cancel_at:
                    break
            time.sleep(0.05)

        self.assertEqual(breaker.failure_count, failures_before)

        with lock:
            times = list(call_times)
            cancelled = list(cancel_at)
        self.assertTrue(cancelled, "stop_event should have been observed")
        cutoff = cancelled[0]
        post_cancel = [t for t in times if t > cutoff + 0.02]
        self.assertEqual(
            post_cancel,
            [],
            f"new N+1 calls after cancel: {len(post_cancel)}",
        )
        abort_mock.assert_called()
        self.assertIsInstance(result, dict)
        self.assertEqual(breaker.failure_count, 0)


if __name__ == "__main__":
    unittest.main()
