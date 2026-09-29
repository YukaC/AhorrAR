"""Host allowlist for discovery + fetch (§V32)."""

from __future__ import annotations

import unittest

from ahorrar_scraper.host_allow import (
    assert_fetch_allowed,
    is_discoverable_host_shape,
    is_private_ip,
    is_safe_crawl_url_shape,
    looks_like_ip_literal,
    pinned_addresses,
    reset_host_allow_dns_cache_for_tests,
    set_dns_resolver_for_tests,
)


class HostAllowTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_host_allow_dns_cache_for_tests()

    def test_accepts_ar_and_bootstrap(self) -> None:
        self.assertTrue(is_discoverable_host_shape("tienda-nueva.com.ar"))
        self.assertTrue(is_discoverable_host_shape("www.fravega.com"))

    def test_rejects_localhost_ip_internal(self) -> None:
        self.assertFalse(is_discoverable_host_shape("localhost"))
        self.assertFalse(is_discoverable_host_shape("127.0.0.1"))
        self.assertFalse(is_discoverable_host_shape("10.0.0.5"))
        self.assertFalse(is_discoverable_host_shape("evil.local"))
        self.assertFalse(is_discoverable_host_shape("metadata.google.internal"))

    def test_rejects_path_injection(self) -> None:
        self.assertFalse(is_discoverable_host_shape("evil.com/path"))
        self.assertFalse(is_discoverable_host_shape("evil.com:8080"))

    def test_private_ip_ranges(self) -> None:
        self.assertTrue(is_private_ip("127.0.0.1"))
        self.assertTrue(is_private_ip("10.1.2.3"))
        self.assertTrue(is_private_ip("172.16.0.1"))
        self.assertTrue(is_private_ip("172.31.255.255"))
        self.assertFalse(is_private_ip("172.32.0.1"))
        self.assertTrue(is_private_ip("192.168.1.1"))
        self.assertTrue(is_private_ip("169.254.169.254"))
        self.assertTrue(is_private_ip("::1"))
        self.assertTrue(is_private_ip("fc00::1"))
        self.assertTrue(is_private_ip("fd12:3456::1"))
        self.assertTrue(is_private_ip("fe80::1"))
        self.assertTrue(is_private_ip("::ffff:10.0.0.1"))
        self.assertFalse(is_private_ip("8.8.8.8"))

    def test_ip_literal_forms(self) -> None:
        self.assertTrue(looks_like_ip_literal("2130706433"))
        self.assertTrue(looks_like_ip_literal("0x7f000001"))
        self.assertTrue(looks_like_ip_literal("0x7f.1"))
        self.assertTrue(looks_like_ip_literal("0177.0.0.1"))
        self.assertFalse(is_discoverable_host_shape("2130706433"))
        self.assertFalse(is_discoverable_host_shape("0x7f.1"))

    def test_url_tricks(self) -> None:
        self.assertFalse(is_safe_crawl_url_shape("http://tienda.com@evil.com/"))
        self.assertFalse(is_safe_crawl_url_shape("https://user:pass@fravega.com/"))
        self.assertFalse(is_safe_crawl_url_shape("file:///etc/passwd"))
        self.assertFalse(is_safe_crawl_url_shape("ftp://fravega.com/"))
        self.assertTrue(is_safe_crawl_url_shape("https://www.fravega.com/search?q=x"))
        self.assertTrue(is_safe_crawl_url_shape("https://www.fravega.com:8443/"))

    def test_assert_fetch_rejects_private_dns(self) -> None:
        calls = {"n": 0}

        def resolver(_host: str) -> list[str]:
            calls["n"] += 1
            return ["169.254.169.254"]

        set_dns_resolver_for_tests(resolver)
        try:
            self.assertFalse(assert_fetch_allowed("https://metadata-trap.com.ar/"))
            self.assertEqual(pinned_addresses("metadata-trap.com.ar"), [])
            self.assertEqual(calls["n"], 1)
        finally:
            set_dns_resolver_for_tests(None)
            reset_host_allow_dns_cache_for_tests()

    def test_assert_fetch_pins_public_dns(self) -> None:
        calls = {"n": 0}

        def resolver(_host: str) -> list[str]:
            calls["n"] += 1
            return ["1.1.1.1"]

        set_dns_resolver_for_tests(resolver)
        try:
            self.assertTrue(assert_fetch_allowed("https://shop-ok.com.ar/p"))
            self.assertEqual(pinned_addresses("shop-ok.com.ar"), ["1.1.1.1"])
            self.assertTrue(assert_fetch_allowed("https://shop-ok.com.ar/p2"))
            self.assertEqual(calls["n"], 1)  # cache hit
        finally:
            set_dns_resolver_for_tests(None)
            reset_host_allow_dns_cache_for_tests()


if __name__ == "__main__":
    unittest.main()
