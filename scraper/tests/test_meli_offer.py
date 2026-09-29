"""ML offer shaping — never publish price≤0 (§V2)."""

from __future__ import annotations

import unittest

from ahorrar_scraper.meli_api import _offer_from_listings


class OfferFromListingsTests(unittest.TestCase):
    def test_no_competitor_returns_none(self) -> None:
        detail = {"name": "Heladera X", "pictures": []}
        self.assertIsNone(_offer_from_listings("MLA1", detail, []))

    def test_listings_without_shipping_returns_none(self) -> None:
        detail = {"name": "Heladera X", "pictures": []}
        listings = [{"price": 1000, "currency_id": "ARS", "shipping": {}}]
        self.assertIsNone(_offer_from_listings("MLA1", detail, listings))

    def test_valid_listing_keeps_price(self) -> None:
        detail = {"name": "Heladera X", "pictures": []}
        listings = [
            {
                "price": 111999,
                "currency_id": "ARS",
                "seller_id": 42,
                "shipping": {"free_shipping": True},
            }
        ]
        offer = _offer_from_listings("MLA1", detail, listings)
        assert offer is not None
        self.assertEqual(offer["price"], 111999.0)
        self.assertGreater(offer["price"], 0)


if __name__ == "__main__":
    unittest.main()
