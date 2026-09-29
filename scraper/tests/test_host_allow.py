"""Host allowlist for discovery (§V32)."""

from __future__ import annotations

import unittest

from ahorrar_scraper.host_allow import is_discoverable_host_shape


class HostAllowTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
