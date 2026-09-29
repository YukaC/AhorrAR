"""Tests for keep/replace victim_index (§V30) + probe candidate filters."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from ahorrar_scraper.crawl import (
    filter_probe_candidates,
    probe_budget,
    victim_index,
)


def _offer(name: str, price: float, host: str, *, source: str | None = None) -> dict:
    o: dict = {
        "name": name,
        "price": price,
        "url": f"https://{host}/p/{price}",
        "store": {"siteUrl": f"https://{host}/"},
    }
    if source:
        o["sourceUrl"] = source
    return o


class VictimIndexTest(unittest.TestCase):
    def test_replaces_more_expensive(self) -> None:
        results = [
            _offer("A", 100, "a.com.ar"),
            _offer("B", 200, "b.com.ar"),
            _offer("C", 300, "c.com.ar"),
            _offer("D", 400, "d.com.ar"),
        ]
        incoming = _offer("Cheap", 50, "e.com.ar")
        vi = victim_index(results, incoming, k_hosts=4)
        self.assertEqual(vi, 3)  # most expensive
        results[vi] = incoming
        self.assertEqual(min(o["price"] for o in results), 50)

    def test_prefers_evicting_same_host_dup(self) -> None:
        results = [
            _offer("A1", 100, "a.com.ar"),
            _offer("A2", 250, "a.com.ar"),
            _offer("B", 200, "b.com.ar"),
            _offer("C", 220, "c.com.ar"),
        ]
        incoming = _offer("A3", 90, "a.com.ar")
        vi = victim_index(results, incoming, k_hosts=3)
        self.assertIsNotNone(vi)
        assert vi is not None
        self.assertEqual(results[vi]["url"], "https://a.com.ar/p/250")

    def test_drops_when_not_better(self) -> None:
        results = [
            _offer("A", 100, "a.com.ar"),
            _offer("B", 200, "b.com.ar"),
            _offer("C", 300, "c.com.ar"),
            _offer("D", 400, "d.com.ar"),
        ]
        incoming = _offer("Expensive", 999, "e.com.ar")
        self.assertIsNone(victim_index(results, incoming, k_hosts=4))


class ProbeFilterTest(unittest.TestCase):
    def test_price_bound_skips_same_host_worse_tier_price(self) -> None:
        # All strong-tier names so tier ties; price decides.
        results = [
            _offer("Cable USB A", 100, "a.com.ar"),
            _offer("Cable USB B", 200, "b.com.ar"),
            _offer("Cable USB C", 300, "c.com.ar"),
            _offer("Cable USB D", 400, "d.com.ar"),
        ]
        cands = [
            _offer("Cable USB worse", 500, "a.com.ar"),
            _offer("Cable USB better", 90, "a.com.ar"),
            _offer("Cable USB newhost", 900, "e.com.ar"),
        ]
        out = filter_probe_candidates(
            cands, results, "cable", max_results=4, k_hosts=4
        )
        urls = {o["url"] for o in out}
        self.assertNotIn("https://a.com.ar/p/500", urls)
        self.assertIn("https://a.com.ar/p/90", urls)
        self.assertIn("https://e.com.ar/p/900", urls)  # new host kept for variety

    def test_strong_tier_beats_weak_even_if_pricier(self) -> None:
        """Retained set all weak/accessory-ish; strong primary more expensive still probes."""
        results = [
            _offer("Funda para notebook 15", 50, "a.com.ar"),
            _offer("Funda notebook neoprene", 60, "b.com.ar"),
            _offer("Cooler pad notebook", 70, "c.com.ar"),
            _offer("Soporte notebook aluminio", 80, "d.com.ar"),
        ]
        # Force weak tiers on retained via names that pass gate but score low is hard;
        # instead mock tiers: patch _offer_tier.
        expensive_primary = _offer("Notebook Lenovo IdeaPad 15 Intel i5", 900_000, "a.com.ar")

        def fake_tier(offer: dict, product: str) -> int:
            name = offer.get("name") or ""
            if "Lenovo" in name:
                return 0
            return 1

        with patch("ahorrar_scraper.crawl._offer_tier", side_effect=fake_tier):
            out = filter_probe_candidates(
                [expensive_primary], results, "notebook", max_results=4, k_hosts=4
            )
        self.assertEqual(len(out), 1)
        self.assertIn("Lenovo", out[0]["name"])

    def test_unpriced_candidate_always_kept(self) -> None:
        results = [
            _offer("Cable USB A", 100, "a.com.ar"),
            _offer("Cable USB B", 200, "b.com.ar"),
            _offer("Cable USB C", 300, "c.com.ar"),
            _offer("Cable USB D", 400, "d.com.ar"),
        ]
        no_price = {
            "name": "Cable USB mystery",
            "url": "https://a.com.ar/p/x",
            "store": {"siteUrl": "https://a.com.ar/"},
        }
        out = filter_probe_candidates(
            [no_price], results, "cable", max_results=4, k_hosts=4
        )
        self.assertEqual(len(out), 1)

    def test_no_bound_until_full_and_diverse(self) -> None:
        results = [_offer("Cable USB A", 100, "a.com.ar")]
        cands = [_offer("Cable USB A2", 999, "a.com.ar")]
        out = filter_probe_candidates(
            cands, results, "cable", max_results=4, k_hosts=4
        )
        self.assertEqual(len(out), 1)

    def test_probe_budget_micro_factor(self) -> None:
        self.assertEqual(probe_budget(10, set_full=False), 20)  # default factor 2
        self.assertGreaterEqual(probe_budget(0, set_full=True), 2)


if __name__ == "__main__":
    unittest.main()
