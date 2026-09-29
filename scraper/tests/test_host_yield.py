"""Unit tests for host yield cut (§V34)."""

from __future__ import annotations

import unittest

from ahorrar_scraper.host_yield import (
    HostYieldTracker,
    clear_outcome_registry,
    outcome_registry_snapshot,
)


class HostYieldTrackerTest(unittest.TestCase):
    def setUp(self) -> None:
        clear_outcome_registry()

    def test_cuts_after_empty_streak(self) -> None:
        # Already have K productive hosts → barren peers can be cut.
        t = HostYieldTracker("electro", empty_streak=2, min_productive=2, budget_s=60)
        for i in range(2):
            t.record_fetch(f"good{i}.com.ar", offers=3, reason="offers")
        self.assertIsNone(
            t.record_fetch("dead.com.ar", offers=0, reason="empty", elapsed_s=0.1)
        )
        cut = t.record_fetch("dead.com.ar", offers=0, reason="empty", elapsed_s=0.1)
        self.assertEqual(cut, "empty")
        self.assertTrue(t.is_cut("dead.com.ar"))
        self.assertFalse(t.should_enqueue("dead.com.ar"))
        self.assertTrue(t.should_enqueue("good0.com.ar"))

    def test_cuts_on_http_error_streak(self) -> None:
        t = HostYieldTracker("gaming", empty_streak=2, min_productive=1, budget_s=60)
        t.record_fetch("alive.com.ar", offers=1, reason="offers")
        t.record_fetch("bad.com.ar", offers=0, reason="http_error", elapsed_s=1.0)
        cut = t.record_fetch("bad.com.ar", offers=0, reason="timeout", elapsed_s=1.0)
        self.assertEqual(cut, "timeout")

    def test_never_cuts_productive_host(self) -> None:
        t = HostYieldTracker("moda", empty_streak=1, min_productive=0, budget_s=0.01)
        t.record_fetch("shop.com.ar", offers=2, reason="offers", elapsed_s=5.0)
        # Even over budget / streak — offers > 0 blocks cut.
        again = t.record_fetch("shop.com.ar", offers=0, reason="empty", elapsed_s=5.0)
        self.assertIsNone(again)
        self.assertFalse(t.is_cut("shop.com.ar"))

    def test_min_productive_blocks_cut(self) -> None:
        t = HostYieldTracker("bazar", empty_streak=1, min_productive=4, budget_s=60)
        # Only 1 productive → do not cut barren hosts yet.
        t.record_fetch("one.com.ar", offers=1, reason="offers")
        cut = t.record_fetch("empty.com.ar", offers=0, reason="empty")
        self.assertIsNone(cut)
        self.assertFalse(t.is_cut("empty.com.ar"))

        # Reach cut-floor K=4 productive → now barren can be cut.
        for i in range(3):
            t.record_fetch(f"p{i}.com.ar", offers=1, reason="offers")
        cut2 = t.record_fetch("empty.com.ar", offers=0, reason="empty")
        self.assertEqual(cut2, "empty")

    def test_default_cut_floor_allows_iphone_style(self) -> None:
        """With default floor 2, three productive shops can cut barren peers."""
        t = HostYieldTracker("electro", empty_streak=2, budget_s=60)
        for i in range(3):
            t.record_fetch(f"live{i}.com.ar", offers=2, reason="offers")
        t.record_fetch("dead.com.ar", offers=0, reason="http_error")
        cut = t.record_fetch("dead.com.ar", offers=0, reason="empty")
        self.assertEqual(cut, "empty")

    def test_streak_override_cuts_sooner(self) -> None:
        t = HostYieldTracker("electro", empty_streak=3, min_productive=1, budget_s=60)
        t.record_fetch("good.com.ar", offers=1, reason="offers")
        cut = t.record_fetch(
            "late.com.ar", offers=0, reason="empty", streak_override=1
        )
        self.assertEqual(cut, "empty")

    def test_preempt_barren(self) -> None:
        t = HostYieldTracker("moda", empty_streak=5, min_productive=2, budget_s=60)
        t.record_fetch("a.com.ar", offers=1, reason="offers")
        t.record_fetch("b.com.ar", offers=1, reason="offers")
        t.stats_for("x.com.ar")  # touch
        newly = t.preempt_barren({"x.com.ar", "a.com.ar"})
        self.assertEqual(newly, ["x.com.ar"])
        self.assertTrue(t.is_cut("x.com.ar"))
        self.assertFalse(t.is_cut("a.com.ar"))

    def test_budget_cut(self) -> None:
        t = HostYieldTracker("general", empty_streak=99, min_productive=1, budget_s=2.0)
        t.record_fetch("ok.com.ar", offers=1, reason="offers")
        t.record_fetch("slow.com.ar", offers=0, reason="empty", elapsed_s=1.5)
        cut = t.record_fetch("slow.com.ar", offers=0, reason="empty", elapsed_s=1.0)
        self.assertEqual(cut, "budget")

    def test_flush_registry(self) -> None:
        t = HostYieldTracker("electro", empty_streak=2, min_productive=1, budget_s=60)
        t.record_fetch("a.com.ar", offers=2, reason="offers")
        t.record_fetch("b.com.ar", offers=0, reason="http_error")
        t.record_fetch("b.com.ar", offers=0, reason="http_error")
        t.flush_to_registry()
        snap = outcome_registry_snapshot()
        self.assertIn(("a.com.ar", "electro"), snap)
        self.assertEqual(snap[("a.com.ar", "electro")][-1].reason, "offers")
        self.assertEqual(snap[("b.com.ar", "electro")][-1].reason, "http_error")
        self.assertGreaterEqual(snap[("b.com.ar", "electro")][-1].fetches, 2)

    def test_summary_by_host(self) -> None:
        t = HostYieldTracker("gaming", empty_streak=2, min_productive=1, budget_s=60)
        t.record_fetch("x.com.ar", offers=5, reason="offers", elapsed_s=0.5)
        s = t.summary()
        self.assertEqual(s["category"], "gaming")
        self.assertEqual(s["byHost"]["x.com.ar"]["offers"], 5)
        self.assertEqual(s["productive"], ["x.com.ar"])


if __name__ == "__main__":
    unittest.main()
