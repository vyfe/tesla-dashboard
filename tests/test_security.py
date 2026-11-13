"""入口加固的单元测试：Basic 鉴权解析 + 静态文件路径约束。

    ./.venv/bin/python -m unittest discover -s tests -t .
"""

from __future__ import annotations

import base64
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import main  # noqa: E402


def basic(user: str, password: str) -> str:
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return f"Basic {token}"


class BasicAuthTest(unittest.TestCase):
    def test_accepts_correct_credentials(self) -> None:
        self.assertTrue(main._basic_auth_ok(basic("tesla", "s3cret"), "tesla", "s3cret"))
        # 方案名大小写不敏感
        self.assertTrue(main._basic_auth_ok(basic("tesla", "s3cret").replace("Basic", "basic"), "tesla", "s3cret"))

    def test_rejects_wrong_password(self) -> None:
        self.assertFalse(main._basic_auth_ok(basic("tesla", "nope"), "tesla", "s3cret"))

    def test_rejects_wrong_user(self) -> None:
        self.assertFalse(main._basic_auth_ok(basic("admin", "s3cret"), "tesla", "s3cret"))

    def test_rejects_missing_or_foreign_scheme(self) -> None:
        self.assertFalse(main._basic_auth_ok(None, "tesla", "s3cret"))
        self.assertFalse(main._basic_auth_ok("", "tesla", "s3cret"))
        self.assertFalse(main._basic_auth_ok("Bearer abc", "tesla", "s3cret"))

    def test_rejects_malformed_base64(self) -> None:
        self.assertFalse(main._basic_auth_ok("Basic 不是base64", "tesla", "s3cret"))
        # 解出来没有冒号
        self.assertFalse(main._basic_auth_ok("Basic " + base64.b64encode(b"tesla").decode(), "tesla", "s3cret"))

    def test_password_may_contain_colon(self) -> None:
        self.assertTrue(main._basic_auth_ok(basic("tesla", "a:b:c"), "tesla", "a:b:c"))

    def test_supports_non_ascii_password(self) -> None:
        self.assertTrue(main._basic_auth_ok(basic("车主", "看板密码"), "车主", "看板密码"))
        self.assertFalse(main._basic_auth_ok(basic("车主", "看板密码"), "车主", "错的"))


class StaticPathTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        root = base / "dist"
        root.mkdir()
        (root / "index.html").write_text("<html>ok</html>", encoding="utf-8")
        (root / "assets").mkdir()
        (root / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
        (base / "secret.txt").write_text("top-secret", encoding="utf-8")
        self.root = root
        self._patch = mock.patch.object(main, "_STATIC_ROOT", root.resolve())
        self._patch.start()

    def tearDown(self) -> None:
        self._patch.stop()
        self.tmp.cleanup()

    def test_serves_file_inside_root(self) -> None:
        self.assertEqual(main._static_file("index.html"), self.root.resolve() / "index.html")
        self.assertEqual(main._static_file("assets/app.js"), self.root.resolve() / "assets" / "app.js")

    def test_missing_file_is_none(self) -> None:
        self.assertIsNone(main._static_file("nope.js"))
        self.assertIsNone(main._static_file(""))

    def test_blocks_parent_traversal(self) -> None:
        self.assertIsNone(main._static_file("../secret.txt"))
        self.assertIsNone(main._static_file("assets/../../secret.txt"))
        self.assertIsNone(main._static_file("./assets/../../secret.txt"))

    def test_blocks_absolute_path(self) -> None:
        self.assertIsNone(main._static_file("/etc/passwd"))


if __name__ == "__main__":
    unittest.main()
