"""Core phrase (§V31) — Python parity with Node."""

from __future__ import annotations

import unittest

from ahorrar_scraper.relevance import (
    core_phrase_tokens,
    is_relevant_result,
    normalize_text,
    query_in_core_phrase,
    query_tokens,
)


class CorePhraseTests(unittest.TestCase):
    def test_cuts_at_connectors(self) -> None:
        hay = normalize_text("Enrollador de cable auriculares")
        self.assertEqual(core_phrase_tokens(hay), ["enrollador"])
        self.assertFalse(query_in_core_phrase(hay, query_tokens("cable")))

    def test_keeps_cable_in_core(self) -> None:
        hay = normalize_text("Cable USB-C a USB-C 1m carga rapida")
        self.assertTrue(query_in_core_phrase(hay, query_tokens("cable")))
        self.assertTrue(is_relevant_result("Cable USB-C a USB-C 1m carga rapida", "cable"))

    def test_rejects_compatible_motherboard_for_ryzen(self) -> None:
        self.assertFalse(
            is_relevant_result("Motherboard AM4 compatible Ryzen 5 5600", "ryzen 5 5600")
        )

    def test_rejects_brand_only_zapatillas(self) -> None:
        self.assertFalse(is_relevant_result("Medias deportivas Nike", "zapatillas nike"))


if __name__ == "__main__":
    unittest.main()
