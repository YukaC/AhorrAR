"""Unit tests for sitemap discovery (no live network)."""

from __future__ import annotations

import unittest

from ahorrar_scraper import seeds


class SitemapParseTests(unittest.TestCase):
    def setUp(self) -> None:
        seeds._sitemap_cache.clear()  # noqa: SLF001 — global cache, per-test isolation

    def test_parse_sitemap_urls_extracts_product_urls(self) -> None:
        body = """<?xml version="1.0"?>
        <urlset>
          <url><loc>https://tienda.com.ar/p/notebook-123</loc></url>
          <url><loc>https://tienda.com.ar/categoria/notebooks</loc></url>
          <url><loc>https://tienda.com.ar/producto/teclado</loc></url>
        </urlset>"""
        urls = seeds._parse_sitemap_urls(body)  # noqa: SLF001
        self.assertIn("https://tienda.com.ar/p/notebook-123", urls)
        self.assertIn("https://tienda.com.ar/producto/teclado", urls)
        self.assertNotIn("https://tienda.com.ar/categoria/notebooks", urls)

    def test_parse_sitemap_urls_limits(self) -> None:
        body = "".join(
            f"<url><loc>https://tienda.com.ar/p/item-{i}</loc></url>" for i in range(20)
        )
        urls = seeds._parse_sitemap_urls(body)  # noqa: SLF001
        self.assertLessEqual(len(urls), seeds.SITEMAP_MAX_URLS)

    def test_sitemap_product_urls_caches(self) -> None:
        calls: list[str] = []

        def fetch_fn(url: str) -> tuple[str, str] | None:
            calls.append(url)
            return (
                url,
                "<urlset><url><loc>https://tienda.com.ar/p/x</loc></url></urlset>",
            )

        first = seeds.sitemap_product_urls("cache-test.com.ar", fetch_fn)
        second = seeds.sitemap_product_urls("cache-test.com.ar", fetch_fn)
        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)  # cached — fetch_fn called once

    def test_sitemap_product_urls_fail_open(self) -> None:
        def fetch_fn(url: str) -> tuple[str, str] | None:
            return None

        self.assertEqual(
            seeds.sitemap_product_urls("failopen-test.com.ar", fetch_fn), []
        )

    def test_sitemap_candidate_hosts_excludes_vtex(self) -> None:
        # Uses the real curated index; VTEX shops must never be sitemap targets.
        hosts = seeds.sitemap_candidate_hosts("perfume", limit=10)
        for host in hosts:
            self.assertNotEqual(seeds.platform_for_host(host), "vtex")


if __name__ == "__main__":
    unittest.main()
