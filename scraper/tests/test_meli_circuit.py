"""Unit tests for the ML API circuit breaker (no live network).

Covers: trip after N consecutive failures, skip while open, half-open probe
after cooldown, success resets, and search_mla integration with the breaker.
"""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from ahorrar_scraper import meli_api


def _mock_response(status_code: int, payload: object | None = None) -> MagicMock:
    res = MagicMock()
    res.status_code = status_code
    if payload is not None:
        res.json.return_value = payload
    return res


class CircuitBreakerTests(unittest.TestCase):
    def setUp(self) -> None:
        self._env_backup = {
            k: os.environ.get(k)
            for k in (
                "MELI_ACCESS_TOKEN",
                "MELI_CIRCUIT_FAILURES",
                "MELI_CIRCUIT_COOLDOWN_S",
            )
        }
        os.environ["MELI_ACCESS_TOKEN"] = "test-token"
        # Fresh breaker per test (threshold 2, cooldown 60s).
        self._breaker = meli_api._CircuitBreaker(2, 60.0)  # noqa: SLF001
        self._patcher = patch.object(meli_api, "_ml_circuit", self._breaker)
        self._patcher.start()

    def tearDown(self) -> None:
        self._patcher.stop()
        for key, value in self._env_backup.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_starts_closed(self) -> None:
        self.assertFalse(self._breaker.is_open())

    def test_trips_after_threshold_failures(self) -> None:
        self._breaker.record_failure()
        self.assertFalse(self._breaker.is_open())
        self._breaker.record_failure()
        self.assertTrue(self._breaker.is_open())

    def test_half_open_after_cooldown(self) -> None:
        self._breaker.record_failure()
        self._breaker.record_failure()
        self.assertTrue(self._breaker.is_open())
        # Expire the cooldown → next probe allowed and state resets.
        self._breaker._open_until = 0.0  # noqa: SLF001
        self.assertFalse(self._breaker.is_open())
        self.assertFalse(self._breaker.is_open())  # stays closed after probe

    def test_success_resets_failures(self) -> None:
        self._breaker.record_failure()
        self._breaker.record_success()
        self.assertFalse(self._breaker.is_open())
        self._breaker.record_failure()
        self.assertFalse(self._breaker.is_open())  # only 1 failure again

    def test_search_skips_when_open(self) -> None:
        self._breaker.record_failure()
        self._breaker.record_failure()
        self.assertTrue(self._breaker.is_open())
        with patch("ahorrar_scraper.meli_api.httpx.Client") as mock_client:
            out = meli_api.search_mla("iphone")
        self.assertEqual(out, [])
        mock_client.assert_not_called()

    def test_search_trips_after_consecutive_429(self) -> None:
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client.get.return_value = _mock_response(429)
        with patch("ahorrar_scraper.meli_api.httpx.Client", return_value=mock_client):
            self.assertEqual(meli_api.search_mla("iphone"), [])
            self.assertEqual(meli_api.search_mla("iphone"), [])
        self.assertTrue(self._breaker.is_open())

    def test_search_success_resets_circuit(self) -> None:
        self._breaker.record_failure()
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client.get.return_value = _mock_response(200, {"results": []})
        with patch("ahorrar_scraper.meli_api.httpx.Client", return_value=mock_client):
            self.assertEqual(meli_api.search_mla("iphone"), [])
        self.assertFalse(self._breaker.is_open())


if __name__ == "__main__":
    unittest.main()
