"""Tests for probe sort order (tier, price) before PDP probe."""

from __future__ import annotations

import unittest

from ahorrar_scraper.crawl import _probe_sort_key


class ProbeSortTest(unittest.TestCase):
    def test_strong_before_weak_regardless_of_price(self) -> None:
        strong = {"name": "Notebook Lenovo IdeaPad 15 Intel i5", "price": 900_000}
        weak = {"name": "Funda para notebook 15.6", "price": 12_000}
        self.assertLess(
            _probe_sort_key(strong, "notebook"),
            _probe_sort_key(weak, "notebook"),
        )

    def test_cheaper_first_within_same_tier(self) -> None:
        a = {"name": "Cable USB-C 1m negro", "price": 3000}
        b = {"name": "Cable USB-C 2m negro", "price": 5000}
        self.assertLess(_probe_sort_key(a, "cable"), _probe_sort_key(b, "cable"))


if __name__ == "__main__":
    unittest.main()
