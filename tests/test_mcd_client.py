"""McdClient 连接行为测试: 不联网(用本机不可达端口 / 未配置场景)。

要点: 麦当劳 MCP 连不上时, 必须抛 McdUnavailable 并给出可读原因,
      且不能影响服务启动(此前会因为启动时强制连接而整站打不开)。

运行(项目根目录): python -m unittest tests.test_mcd_client -v
"""
import asyncio
import os
import unittest
from unittest import mock

from app.mcd_client import McdClient, McdUnavailable, _brief, _leaves

try:  # Python 3.11+ 内置; 3.10 用 exceptiongroup 回填包(mcp 的依赖, 已随 requirements 安装)
    BaseExceptionGroup
except NameError:  # pragma: no cover
    from exceptiongroup import BaseExceptionGroup


def run(coro):
    return asyncio.run(coro)


class McdClientTest(unittest.TestCase):
    def client(self, url="http://127.0.0.1:9", token="t"):
        with mock.patch.dict(os.environ, {"MCD_MCP_URL": url, "MCD_MCP_TOKEN": token}):
            return McdClient()

    def test_构造不联网且不因缺配置崩溃(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch("app.mcd_client.load_env"):
            c = McdClient()
        self.assertFalse(c.configured)

    def test_未配置时给出明确提示(self):
        c = self.client(url="", token="")
        with self.assertRaises(McdUnavailable) as cm:
            run(c.call("now-time-info"))
        self.assertIn("MCD_MCP_URL", str(cm.exception))

    def test_地址不可达时提示网络问题而不是CancelledError(self):
        c = self.client()
        with self.assertRaises(McdUnavailable) as cm:
            run(c.call("now-time-info"))
        msg = str(cm.exception)
        self.assertIn("连不上", msg)
        self.assertNotIn("CancelledError", msg)

    def test_失败后可以重试而不是永久卡死(self):
        c = self.client()
        for _ in range(3):
            with self.assertRaises(McdUnavailable):
                run(c.call("now-time-info"))

    def test_写操作闸门仍然有效且不需要联网(self):
        c = self.client()
        for name in ("create-order", "cancel-order", "mall-create-order", "draw-lottery"):
            with self.assertRaises(PermissionError):
                run(c.call(name, {}))

    def test_brief展开异常组并跳过取消类异常(self):
        class Boom(Exception):
            pass

        g = BaseExceptionGroup("x", [asyncio.CancelledError("cancel"), Boom("真正的原因")])
        self.assertEqual(len(list(_leaves(g))), 2)
        self.assertIn("Boom", _brief(g))

    def test_brief对连接错误给出友好文案(self):
        import httpx

        self.assertIn("网络连不上", _brief(httpx.ConnectError("refused")))


if __name__ == "__main__":
    unittest.main()
