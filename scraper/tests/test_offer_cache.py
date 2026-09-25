"""Unit tests for OfferCache (no live network)."""

from __future__ import annotations

import time
import unittest

from ahorrar_scraper.offer_cache import OfferCache


class OfferCacheTests(unittest.TestCase):
    def test_get_missing_host_returns_none(self) -> None:
        cache = OfferCache()
        self.assertIsNone(cache.get("fravega.com"))

    def test_add_then_get_returns_offers(self) -> None:
        cache = OfferCache()
        cache.add(
            "fravega.com",
            [{"url": "https://fravega.com/p/x", "name": "X", "price": 100.0}],
        )
        offers = cache.get("fravega.com")
        self.assertIsNotNone(offers)
        assert offers is not None
        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0]["url"], "https://fravega.com/p/x")

    def test_get_returns_copy_not_reference(self) -> None:
        cache = OfferCache()
        cache.add("fravega.com", [{"url": "u1", "name": "X"}])
        offers = cache.get("fravega.com")
        self.assertIsNotNone(offers)
        assert offers is not None
        offers.append({"url": "u2"})
        cached_again = cache.get("fravega.com")
        self.assertIsNotNone(cached_again)
        assert cached_again is not None
        self.assertEqual(len(cached_again), 1)

    def test_add_dedupes_by_url(self) -> None:
        cache = OfferCache()
        cache.add(
            "fravega.com",
            [{"url": "u1", "name": "A"}, {"url": "u1", "name": "B"}],
        )
        offers = cache.get("fravega.com")
        self.assertIsNotNone(offers)
        assert offers is not None
        self.assertEqual(len(offers), 1)

    def test_add_merges_across_calls(self) -> None:
        cache = OfferCache()
        cache.add("fravega.com", [{"url": "u1", "name": "A"}])
        cache.add("fravega.com", [{"url": "u2", "name": "B"}])
        offers = cache.get("fravega.com")
        self.assertIsNotNone(offers)
        assert offers is not None
        self.assertEqual(len(offers), 2)

    def test_ttl_expiry(self) -> None:
        cache = OfferCache(ttl_s=1)
        cache.add("fravega.com", [{"url": "u1", "name": "A"}])
        time.sleep(1.1)
        self.assertIsNone(cache.get("fravega.com"))

    def test_max_offers_per_host_fifo(self) -> None:
        cache = OfferCache(max_offers_per_host=2)
        cache.add("fravega.com", [{"url": f"u{i}", "name": str(i)} for i in range(3)])
        offers = cache.get("fravega.com")
        self.assertIsNotNone(offers)
        assert offers is not None
        self.assertEqual(len(offers), 2)
        self.assertEqual(offers[0]["url"], "u1")  # u0 evicted (FIFO)

    def test_max_hosts_eviction(self) -> None:
        cache = OfferCache(max_hosts=2)
        cache.add("a.com", [{"url": "u1"}])
        cache.add("b.com", [{"url": "u2"}])
        cache.add("c.com", [{"url": "u3"}])
        self.assertEqual(cache.size, 2)
        self.assertIsNone(cache.get("a.com"))  # oldest evicted

    def test_add_empty_offers_noop(self) -> None:
        cache = OfferCache()
        cache.add("fravega.com", [])
        self.assertIsNone(cache.get("fravega.com"))

    def test_clear(self) -> None:
        cache = OfferCache()
        cache.add("fravega.com", [{"url": "u1"}])
        cache.clear()
        self.assertEqual(cache.size, 0)


if __name__ == "__main__":
    unittest.main()
