"""Unit tests for ML OAuth auto-refresh (no live network)."""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from ahorrar_scraper import meli_auth


class MeliAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self._env_backup = {
            k: os.environ.get(k)
            for k in (
                "MELI_ACCESS_TOKEN",
                "MELI_REFRESH_TOKEN",
                "MELI_APP_ID",
                "MELI_CLIENT_SECRET",
                "MELI_TOKEN_FILE",
            )
        }
        meli_auth._loaded_file = False  # noqa: SLF001

    def tearDown(self) -> None:
        for key, value in self._env_backup.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        meli_auth._loaded_file = False  # noqa: SLF001

    def test_load_file_overrides_stale_env(self) -> None:
        path = Path(self.id().replace(".", "_") + "_tokens.json")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        path.write_text(
            json.dumps(
                {
                    "MELI_ACCESS_TOKEN": "file-access",
                    "MELI_REFRESH_TOKEN": "file-refresh",
                }
            ),
            encoding="utf-8",
        )
        os.environ["MELI_TOKEN_FILE"] = str(path)
        os.environ["MELI_ACCESS_TOKEN"] = "stale-access"
        os.environ["MELI_REFRESH_TOKEN"] = "stale-refresh"
        meli_auth.load_tokens_from_file(force=True)
        self.assertEqual(os.environ["MELI_ACCESS_TOKEN"], "file-access")
        self.assertEqual(os.environ["MELI_REFRESH_TOKEN"], "file-refresh")

    def test_refresh_persists_new_tokens(self) -> None:
        path = Path(self.id().replace(".", "_") + "_tokens.json")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        os.environ["MELI_TOKEN_FILE"] = str(path)
        os.environ["MELI_ACCESS_TOKEN"] = "old-access"
        os.environ["MELI_REFRESH_TOKEN"] = "old-refresh"
        os.environ["MELI_APP_ID"] = "app"
        os.environ["MELI_CLIENT_SECRET"] = "secret"
        meli_auth._loaded_file = True  # noqa: SLF001 — skip file load

        mock_res = MagicMock()
        mock_res.status_code = 200
        mock_res.json.return_value = {
            "access_token": "new-access",
            "refresh_token": "new-refresh",
        }
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = False
        mock_client.post.return_value = mock_res

        with patch("ahorrar_scraper.meli_auth.httpx.Client", return_value=mock_client):
            ok = meli_auth.refresh_access_token()

        self.assertTrue(ok)
        self.assertEqual(os.environ["MELI_ACCESS_TOKEN"], "new-access")
        self.assertEqual(os.environ["MELI_REFRESH_TOKEN"], "new-refresh")
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(saved["MELI_ACCESS_TOKEN"], "new-access")
        self.assertEqual(saved["MELI_REFRESH_TOKEN"], "new-refresh")

    def test_refresh_after_unauthorized_only_on_401(self) -> None:
        self.assertFalse(meli_auth.refresh_after_unauthorized(403))
        self.assertFalse(meli_auth.refresh_after_unauthorized(200))


if __name__ == "__main__":
    unittest.main()
