"""Stock filters for Woo/Shopify parsers (T60)."""

from __future__ import annotations

import json
import unittest

from ahorrar_scraper.parsers import parse_shopify_suggest_or_products, parse_woo_store_api


class StockFilterTests(unittest.TestCase):
    def test_woo_skips_out_of_stock(self) -> None:
        body = json.dumps(
            [
                {
                    "name": "Mouse Gamer In Stock",
                    "permalink": "https://shop.example/product/mouse-ok/",
                    "prices": {"price": "10000", "currency_minor_unit": 2},
                    "is_in_stock": True,
                    "is_purchasable": True,
                    "images": [],
                },
                {
                    "name": "Mouse Gamer OOS",
                    "permalink": "https://shop.example/product/mouse-oos/",
                    "prices": {"price": "5000", "currency_minor_unit": 2},
                    "is_in_stock": False,
                    "is_purchasable": True,
                    "images": [],
                },
            ]
        )
        out = parse_woo_store_api(
            "https://shop.example/wp-json/wc/store/v1/products?search=mouse",
            body,
        )
        self.assertEqual(len(out), 1)
        self.assertIn("In Stock", out[0]["name"])

    def test_shopify_skips_unavailable(self) -> None:
        body = json.dumps(
            {
                "products": [
                    {
                        "title": "Teclado Mecanico OK",
                        "handle": "teclado-ok",
                        "price": "20000",
                        "available": True,
                    },
                    {
                        "title": "Teclado Mecanico OOS",
                        "handle": "teclado-oos",
                        "price": "10000",
                        "available": False,
                    },
                ]
            }
        )
        out = parse_shopify_suggest_or_products(
            "https://shop.example/products.json?q=teclado",
            body,
        )
        self.assertEqual(len(out), 1)
        self.assertIn("OK", out[0]["name"])


if __name__ == "__main__":
    unittest.main()
