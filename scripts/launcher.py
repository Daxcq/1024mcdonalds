"""双击启动入口(由 start.bat 调用, 也可以直接运行)。

做的事, 按顺序
  0. 服务已经在跑 -> 直接打开浏览器, 不重复启动
  1. 依赖没装全, 或 requirements.txt 改过 -> 自动 pip install(默认源失败会换 pypi.org / 阿里云)
  2. 没有 .env -> 用 .env.example 生成一份并引导你填写
  3. 自检: 能让服务起不来的问题(Python 版本、文件、依赖、端口)会拦住;
     配置和网络问题(.env、代理、麦当劳 MCP)只提示, 页面照样能打开
  4. 启动服务, 就绪后自动打开浏览器

只监听 127.0.0.1。关闭这个窗口(或 Ctrl+C)即停止服务。
用法: python scripts/launcher.py [--port 8000] [--no-browser] [--skip-install]
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEP_IMPORTS = ("fastapi", "uvicorn", "starlette", "mcp", "openai", "pydantic", "httpx")
# 依次尝试的 pip 源: 默认源(可能是镜像, 可能缺新版本) -> 官方 -> 阿里云
INDEXES = (None, "https://pypi.org/simple", "https://mirrors.aliyun.com/pypi/simple/")


# ---------- 依赖 ----------
def req_hash(path: Path | None = None) -> str:
    """requirements.txt 的指纹。统一换行符, 避免 git 的 CRLF/LF 转换造成"每次都重装"。"""
    p = path or (ROOT / "requirements.txt")
    return hashlib.sha256(p.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def stamp_file() -> Path:
    """装依赖的记号放在当前 Python 环境(.venv)里, 一个环境一份, 删掉 .venv 自然失效。"""
    return Path(sys.prefix) / ".requirements.sha256"


def read_stamp() -> str:
    try:
        return stamp_file().read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def needs_install(stamp: str, current: str, imports_ok: bool) -> bool:
    return (not imports_ok) or stamp != current


def imports_ok(python: str = sys.executable) -> bool:
    r = subprocess.run([python, "-c", "import " + ", ".join(DEP_IMPORTS)], capture_output=True)
    return r.returncode == 0


def install(req: Path, runner=subprocess.call, python: str = sys.executable) -> bool:
    for idx in INDEXES:
        cmd = [python, "-m", "pip", "install", "-r", str(req)] + (["-i", idx] if idx else [])
        print(f"[安装] pip install -r requirements.txt" + (f"  (源: {idx})" if idx else ""), flush=True)
        if runner(cmd) == 0:
            return True
        print("[安装] 这个源没装成功, 换下一个试试", flush=True)
    return False


def ensure_deps() -> bool:
    cur = req_hash()
    ok = imports_ok()
    if not needs_install(read_stamp(), cur, ok):
        print("[ OK ] 依赖已是最新, 跳过安装")
        return True
    print("[安装] " + ("依赖缺失, 开始安装(第一次需要几分钟)" if not ok else "requirements.txt 有变化, 更新依赖"))
    if not install(ROOT / "requirements.txt"):
        print("[失败] 依赖安装失败。请检查网络, 或在本窗口里手动运行:")
        print("       pip install -r requirements.txt -i https://pypi.org/simple")
        return False
    if not imports_ok():
        print("[失败] 安装结束了, 但依赖仍然无法导入。删除 .venv 文件夹后重新双击 start.bat 通常能解决。")
        return False
    try:
        stamp_file().write_text(cur, encoding="utf-8")
    except OSError:
        pass  # 写不进去只会导致下次多检查一次, 不影响本次启动
    return True


# ---------- 服务状态 ----------
def server_alive(port: int, timeout: float = 1.5) -> bool:
    """端口上跑的确实是本项目的服务(而不是别的程序)。靠 /api/config 返回里的 demo 字段判断。"""
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/config", timeout=timeout) as r:
            return "demo" in json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - 任何失败都当作"不是我们的服务"
        return False


def port_busy(port: int) -> bool:
    s = socket.socket()
    s.settimeout(1)
    try:
        return s.connect_ex((HOST, port)) == 0
    finally:
        s.close()


def open_when_ready(url: str, port: int, tries: int = 120) -> bool:
    for _ in range(tries):
        if server_alive(port):
            webbrowser.open(url)
            return True
        time.sleep(0.5)
    return False


# ---------- .env ----------
def ensure_env(root: Path = ROOT, interactive: bool = True, open_editor: bool = True) -> bool:
    env = root / ".env"
    if env.exists():
        return True
    example = root / ".env.example"
    if not example.exists():
        print("[注意] 没有 .env, 也没有 .env.example。页面能打开, 但选门店和聊天不可用。")
        return True
    shutil.copyfile(example, env)
    print("[注意] 第一次运行: 已用 .env.example 生成 .env, 请把里面的 token / key 填上。")
    print("       不填也能先看离线演示菜单, 只是选门店和聊天用不了。")
    if open_editor and sys.platform == "win32":
        try:
            subprocess.Popen(["notepad", str(env)])
        except OSError:
            pass
    if interactive:
        try:
            input("       填好并保存后按回车继续 (直接回车 = 先不填)... ")
        except EOFError:
            pass
    return True


# ---------- 自检 ----------
def run_checks(doctor, port: int) -> tuple[int, int]:
    """返回 (会让服务起不来的问题数, 只需提示的问题数)。"""
    doctor.PORT = port
    doctor.failed = 0
    for fn in (doctor.check_python, doctor.check_dirs, doctor.check_deps, doctor.check_port):
        fn()
    hard = doctor.failed
    doctor.failed = 0
    for fn in (doctor.check_env, doctor.check_proxy):
        fn()
    try:
        asyncio.run(doctor.check_mcp())   # 连不上也只是提示: 服务是懒连接, 页面照常能开
    except Exception as e:  # noqa: BLE001
        print(f"[注意] 麦当劳 MCP 检查没跑成: {type(e).__name__}")
        doctor.failed += 1
    return hard, doctor.failed


# ---------- 入口 ----------
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="一键启动麦当劳点餐服务")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    ap.add_argument("--skip-install", action="store_true", help="跳过依赖检查与安装")
    a = ap.parse_args(argv)
    os.chdir(ROOT)
    url = f"http://{HOST}:{a.port}"
    print(f"项目目录: {ROOT}\n")

    # 0. 已经在跑
    if server_alive(a.port):
        print(f"[ OK ] 服务已在运行: {url}")
        if not a.no_browser:
            webbrowser.open(url)
        return 0

    # 1. 依赖
    if not a.skip_install and not ensure_deps():
        return 1

    # 2. .env
    ensure_env()

    # 3. 自检
    sys.path.insert(0, str(ROOT))
    import scripts.doctor as doctor   # 延后导入: 依赖装好之后才能导入它用到的包

    hard, soft = run_checks(doctor, a.port)
    print()
    if hard:
        print(f"有 {hard} 项问题会导致服务无法启动, 请按上面 [失败] 后面的提示处理, 然后重新双击。")
        return 1
    if soft:
        print(f"有 {soft} 项提示(见上)。不影响打开页面; 如果选门店或聊天不能用, 先处理这些。")

    # 4. 启动
    print(f"\n启动中: {url}")
    print("关闭这个窗口(或按 Ctrl+C)即可停止服务。\n")
    if not a.no_browser:
        threading.Thread(target=open_when_ready, args=(url, a.port), daemon=True).start()
    cmd = [sys.executable, "-m", "uvicorn", "app.server:app", "--host", HOST, "--port", str(a.port)]
    try:
        return subprocess.call(cmd, cwd=ROOT, env=dict(os.environ, PYTHONUTF8="1"))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
