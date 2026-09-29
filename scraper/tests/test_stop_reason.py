"""stopReason is one of the four BFS exit labels (§T61)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from ahorrar_scraper import crawl as crawl_mod


class StopReasonTests(unittest.TestCase):
    def test_empty_seeds_queue_empty(self) -> None:
        with (
            patch.object(crawl_mod, "build_seed_urls", return_value=[]),
            patch.object(crawl_mod, "meli_token_configured", return_value=False),
            patch.object(crawl_mod, "sitemap_candidate_hosts", return_value=[]),
        ):
            out = crawl_mod.crawl(
                "cable",
                max_results=5,
                max_depth=0,
                max_nodes=5,
                include_ml=False,
            )
        reason = out["stats"]["stopReason"]
        self.assertIn(reason, {"satisfied", "deadline", "max_nodes", "queue_empty"})
        self.assertEqual(reason, "queue_empty")
        self.assertEqual(out["stats"]["mlArrived"], 0)


if __name__ == "__main__":
    unittest.main()
