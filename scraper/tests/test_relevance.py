"""Relevance filter parity with backend/src/search/relevance.ts (§V24–§V29)."""

from __future__ import annotations

import unittest

from ahorrar_scraper.relevance import (
    is_relevant_result,
    query_tokens,
    title_matches_query,
    title_relevance_score,
)


class TestTitleMatchesQuery(unittest.TestCase):
    def test_model_and_inches(self) -> None:
        self.assertTrue(title_matches_query("Procesador AMD Ryzen 5 5600 6/12", "ryzen 5 5600"))
        self.assertFalse(title_matches_query('TV BGH HD 32" Android TV', "smart tv 55"))
        self.assertTrue(title_matches_query('Smart TV 55" Samsung Crystal 4K', "smart tv 55"))

    def test_digit_boundary(self) -> None:
        self.assertFalse(title_matches_query("AMD Ryzen 5600", "ryzen 5 5600"))
        self.assertTrue(title_matches_query("AMD Ryzen 5 5600", "ryzen 5 5600"))

    def test_perfume_needs_fragrance_evidence(self) -> None:
        self.assertEqual(query_tokens("perfume de bensimon"), ["perfume", "bensimon"])
        self.assertTrue(title_matches_query("Bensimon Sunset Edp 100ml", "perfume"))
        self.assertTrue(title_matches_query("Carolina Herrera 212 Men 100ml", "perfume"))
        self.assertTrue(title_matches_query("Perfume Dior Sauvage EDP 100ml", "perfume"))
        self.assertFalse(title_matches_query("Crema corporal hidratante 200ml", "perfume"))
        self.assertFalse(title_matches_query("Jabon liquido aroma vainilla", "perfume"))
        self.assertFalse(
            title_matches_query(
                "Protectores Diarios Always Xtra Diarios Extra Largos Con Perfume X 100 Unid",
                "perfume",
            )
        )
        self.assertFalse(
            title_matches_query("Toallas Húmedas Johnson's Baby Extra Cuidado X 96 Un", "perfume")
        )
        self.assertTrue(title_matches_query("Bensimon Sunset Edp 100ml", "perfume bensimon"))
        self.assertFalse(title_matches_query("EDT Agua Fresca x 120 ml", "perfume bensimon"))

    def test_brand_required(self) -> None:
        self.assertTrue(title_matches_query("Iphone 16 128gb", "iphone"))
        self.assertFalse(title_matches_query("Bafle Philips TAX2706 77", "iphone"))

    def test_v27_rejects_secondaries(self) -> None:
        self.assertTrue(title_matches_query("Notebook Lenovo IdeaPad 15 Intel i5", "notebook"))
        self.assertTrue(title_matches_query("Laptop HP Pavilion 14 Ryzen 5", "notebook"))
        self.assertFalse(title_matches_query("Memoria RAM DDR4 8GB para Notebook", "notebook"))
        self.assertFalse(title_matches_query("Funda Notebook 15.6 Neoprene", "notebook"))
        self.assertFalse(title_matches_query("Soporte refrigerante para notebook", "notebook"))
        self.assertFalse(title_matches_query("Memoria Kingston Fury 8GB", "notebook"))
        self.assertTrue(title_matches_query("Funda Notebook 15.6 Neoprene", "funda notebook"))
        self.assertTrue(title_matches_query("Memoria RAM DDR4 8GB Notebook", "ram notebook"))
        self.assertFalse(title_matches_query("Muestra tester perfume 5ml", "perfume"))
        self.assertFalse(title_matches_query("Crema hidratante Carolina Herrera", "perfume"))

    def test_v29_cross_class(self) -> None:
        self.assertFalse(title_matches_query("Notebook Lenovo IdeaPad 15", "perfume"))
        self.assertFalse(title_matches_query("Zapatillas Nike Air Max 90", "perfume"))
        self.assertFalse(title_matches_query("Perfume Dior Sauvage EDP 100ml", "notebook"))

    def test_is_relevant_result_publish_floor(self) -> None:
        self.assertTrue(is_relevant_result("Notebook Lenovo IdeaPad 15 Intel i5", "notebook"))
        self.assertTrue(is_relevant_result("Dior Sauvage EDP 100ml", "perfume"))
        self.assertTrue(is_relevant_result("Iphone 16 128gb", "iphone"))
        self.assertFalse(is_relevant_result("Cable HDMI 2m negro", "notebook"))
        self.assertFalse(is_relevant_result("Protectores Diarios Always Con Perfume", "perfume"))
        self.assertFalse(is_relevant_result("Zapatillas Nike Revolution", "perfume"))

    def test_relevance_score_primary_beats_weak(self) -> None:
        primary = title_relevance_score("Notebook Lenovo IdeaPad 15", "notebook")
        weak = title_relevance_score("Cable HDMI 2m negro", "notebook")
        self.assertGreaterEqual(primary, 0.55)
        self.assertLess(weak, 0.55)
        frag = title_relevance_score("Dior Sauvage EDP 100ml", "perfume")
        cream = title_relevance_score("Crema corporal 200ml", "perfume")
        self.assertGreater(frag, cream)
        self.assertGreaterEqual(frag, 0.55)


if __name__ == "__main__":
    unittest.main()
