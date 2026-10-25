"""启动脚本的测试。不装包、不联网、不真正打开浏览器。

运行(项目根目录): python -m unittest tests.test_launcher -v
"""
import http.server
import json
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from scripts import launcher as L


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class _Handler(http.server.BaseHTTPRequestHandler):
    body = b'{"demo": true}'
    code = 200

    def do_GET(self):
        self.send_response(self.code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(self.body)

    def log_message(self, *a):
        pass


class _Srv(http.server.HTTPServer):
    def shutdown(self):            # 关闭时同时释放监听套接字, 否则会留下未关闭的句柄
        super().shutdown()
        self.server_close()


def serve(body=b'{"demo": true}', code=200):
    h = type("H", (_Handler,), {"body": body, "code": code})
    srv = _Srv(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


class ServerAliveTest(unittest.TestCase):
    def test_我们的服务返回demo字段才算存活(self):
        srv, port = serve()
        try:
            self.assertTrue(L.server_alive(port))
        finally:
            srv.shutdown()

    def test_别的程序占着同一端口不能误判为我们的服务(self):
        srv, port = serve(body=b"<html>other app</html>")
        try:
            self.assertFalse(L.server_alive(port))
            self.assertTrue(L.port_busy(port))
        finally:
            srv.shutdown()

    def test_返回JSON但没有demo字段也不算(self):
        srv, port = serve(body=b'{"hello": 1}')
        try:
            self.assertFalse(L.server_alive(port))
        finally:
            srv.shutdown()

    def test_端口空闲(self):
        p = free_port()
        self.assertFalse(L.server_alive(p))
        self.assertFalse(L.port_busy(p))


class NeedsInstallTest(unittest.TestCase):
    def test_决策表(self):
        self.assertFalse(L.needs_install("h", "h", True))     # 都对 -> 跳过
        self.assertTrue(L.needs_install("h", "h", False))     # 导入失败 -> 装
        self.assertTrue(L.needs_install("old", "new", True))  # requirements 变了 -> 装
        self.assertTrue(L.needs_install("", "h", True))       # 没有记号 -> 装
        self.assertTrue(L.needs_install("", "h", False))

    def test_指纹不受换行符影响(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d, "a.txt"), Path(d, "b.txt")
            a.write_bytes(b"x==1\ny==2\n")
            b.write_bytes(b"x==1\r\ny==2\r\n")
            self.assertEqual(L.req_hash(a), L.req_hash(b))

    def test_内容变了指纹就变(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d, "a.txt"), Path(d, "b.txt")
            a.write_text("x==1\n")
            b.write_text("x==2\n")
            self.assertNotEqual(L.req_hash(a), L.req_hash(b))


class InstallFallbackTest(unittest.TestCase):
    def test_第一个源成功就不再试别的(self):
        calls = []
        ok = L.install(Path("r.txt"), runner=lambda c: calls.append(c) or 0, python="py")
        self.assertTrue(ok)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("-i", calls[0])

    def test_失败后依次换源(self):
        seen = []

        def runner(cmd):
            seen.append(cmd[cmd.index("-i") + 1] if "-i" in cmd else "默认")
            return 1 if len(seen) < 3 else 0

        self.assertTrue(L.install(Path("r.txt"), runner=runner, python="py"))
        self.assertEqual(seen, ["默认", "https://pypi.org/simple", "https://mirrors.aliyun.com/pypi/simple/"])

    def test_全部失败返回False(self):
        self.assertFalse(L.install(Path("r.txt"), runner=lambda c: 1, python="py"))


class EnsureEnvTest(unittest.TestCase):
    def test_已有env不动它(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / ".env").write_text("KEEP=1\n")
            (root / ".env.example").write_text("NEW=2\n")
            L.ensure_env(root, interactive=False, open_editor=False)
            self.assertEqual((root / ".env").read_text(), "KEEP=1\n")

    def test_没有env时从示例生成(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / ".env.example").write_text("MCD_MCP_URL=x\n")
            L.ensure_env(root, interactive=False, open_editor=False)
            self.assertEqual((root / ".env").read_text(), "MCD_MCP_URL=x\n")

    def test_示例也没有时不崩(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertTrue(L.ensure_env(Path(d), interactive=False, open_editor=False))
            self.assertFalse((Path(d) / ".env").exists())


class MainFlowTest(unittest.TestCase):
    def test_服务已在运行时只开浏览器不重复启动(self):
        srv, port = serve()
        try:
            with mock.patch.object(L.webbrowser, "open") as op, mock.patch.object(L.subprocess, "call") as call:
                rc = L.main(["--port", str(port)])
            self.assertEqual(rc, 0)
            op.assert_called_once()
            call.assert_not_called()
        finally:
            srv.shutdown()

    def test_已运行且指定不开浏览器(self):
        srv, port = serve()
        try:
            with mock.patch.object(L.webbrowser, "open") as op:
                self.assertEqual(L.main(["--port", str(port), "--no-browser"]), 0)
            op.assert_not_called()
        finally:
            srv.shutdown()

    def test_依赖装不上时停止且给出非零退出码(self):
        p = free_port()
        with mock.patch.object(L, "ensure_deps", return_value=False), mock.patch.object(L.subprocess, "call") as call:
            self.assertEqual(L.main(["--port", str(p), "--no-browser"]), 1)
        call.assert_not_called()

    def test_端口被别的程序占用时不启动服务(self):
        srv, port = serve(body=b"<html>other</html>")
        try:
            with mock.patch.object(L, "ensure_deps", return_value=True), \
                 mock.patch.object(L, "ensure_env", return_value=True), \
                 mock.patch.object(L.subprocess, "call") as call:
                rc = L.main(["--port", str(port), "--no-browser", "--skip-install"])
            self.assertEqual(rc, 1)
            call.assert_not_called()
        finally:
            srv.shutdown()


class BatFileTest(unittest.TestCase):
    """start.bat 在 Linux 上跑不了, 这里只做静态检查: 最容易让 .bat 在中文路径 / 旧系统上出错的几点。"""

    @classmethod
    def setUpClass(cls):
        cls.raw = (Path(__file__).resolve().parent.parent / "start.bat").read_bytes()
        cls.text = cls.raw.decode("ascii")

    def test_只含ASCII(self):
        self.assertTrue(all(b < 128 for b in self.raw))

    def test_使用CRLF换行(self):
        self.assertNotIn(b"\n", self.raw.replace(b"\r\n", b""))

    def test_所有goto目标都有对应标签(self):
        import re

        targets = set(re.findall(r"goto\s+(\w+)", self.text))
        labels = set(re.findall(r"^:(\w+)", self.text, re.M))
        self.assertTrue(targets)
        self.assertLessEqual(targets, labels)

    def test_切换到脚本所在目录且支持盘符切换(self):
        self.assertIn('cd /d "%~dp0"', self.text)

    def test_含目录变量的路径都被引号包住(self):
        """含 %~dp0 的每一处, 所在位置必须处于一对引号之内(目录可能有中文或空格)。
        两种写法都合法: cd /d "%~dp0"  和  set "X=%~dp0..."。"""
        for n, line in enumerate(self.text.splitlines(), 1):
            for i in [j for j in range(len(line)) if line.startswith("%~dp0", j)]:
                inside = line[:i].count('"') % 2 == 1      # 前面引号数为奇数 = 正处在引号内
                self.assertTrue(inside, f"第 {n} 行 %~dp0 不在引号内: {line.strip()}")


if __name__ == "__main__":
    unittest.main()
