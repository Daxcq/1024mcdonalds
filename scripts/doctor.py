"""启动前自检: 逐项检查"网页打不开"最常见的原因, 并给出下一步该做什么。

用法(项目根目录, 已激活 .venv):
    python scripts/doctor.py          # 只检查
    python scripts/doctor.py --run    # 全部通过后直接启动服务

不会修改任何文件, 不会打印密钥内容。
"""
import asyncio
import importlib
import os
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
HOST, PORT = "127.0.0.1", 8000
OK, BAD, WARN = "[ OK ]", "[失败]", "[注意]"
failed = 0


def show(tag, msg, fix=""):
    global failed
    if tag == BAD:
        failed += 1
    print(f"{tag} {msg}")
    if fix:
        print(f"       -> {fix}")


def check_python():
    v = sys.version_info
    if v < (3, 10):
        show(BAD, f"Python {v.major}.{v.minor} 太低", "需要 3.10 或更高, 换新版本后重建 .venv")
    else:
        show(OK, f"Python {v.major}.{v.minor}.{v.micro}")
    if not (ROOT / ".venv").exists() or Path(sys.prefix).resolve() == Path(sys.base_prefix).resolve():
        show(WARN, "当前不在项目的虚拟环境里", r"先执行 .venv\Scripts\activate 再运行本脚本")


def check_dirs():
    cwd_ok = Path.cwd().resolve() == ROOT
    if not cwd_ok:
        show(WARN, f"当前目录是 {Path.cwd()}", f"启动服务前请先 cd {ROOT}")
    for rel in ("index.html", "js/engine.js", "js/api.js", "assets/kitchen_bg.png", "app/server.py",
                "data/stores_changchun.json", "data/city_burgers_changchun.json"):
        if not (ROOT / rel).exists():
            show(BAD, f"缺文件 {rel}", "确认没有只复制了部分目录; 用 git status 看是否被误删")
            return
    show(OK, "页面与数据文件齐全")


def check_deps():
    need = ["fastapi", "uvicorn", "starlette", "mcp", "openai", "pydantic", "httpx"]
    missing = []
    for m in need:
        try:
            importlib.import_module(m)
        except Exception as e:  # noqa: BLE001
            missing.append(f"{m}({type(e).__name__})")
    if missing:
        show(BAD, "依赖缺失或损坏: " + ", ".join(missing), "pip install -r requirements.txt -i https://pypi.org/simple")
    else:
        show(OK, "依赖都能导入")


def check_env():
    p = ROOT / ".env"
    if not p.exists():
        show(BAD, "没有 .env 文件", "复制 .env.example 为 .env 并填入密钥")
        return
    raw = p.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        show(WARN, ".env 带 BOM 头(记事本保存导致)", "新版已兼容, 无需处理")
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        show(BAD, ".env 是 UTF-16 编码(PowerShell 的 > 重定向会这样)", "用 VS Code 另存为 UTF-8")
        return
    from app.mcd_client import load_env
    load_env()
    for k in ("MCD_MCP_URL", "MCD_MCP_TOKEN"):
        v = os.environ.get(k, "")
        if not v:
            show(BAD, f".env 里 {k} 是空的", "填入后重启服务")
        elif v != v.strip() or any(c in v for c in "\"'"):
            show(WARN, f"{k} 首尾有空格或引号", "去掉多余的引号和空格")
        else:
            show(OK, f"{k} 已填写 (长度 {len(v)})")
    llm = [k for k in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL") if not os.environ.get(k)]
    show(OK if not llm else WARN, "对话模型已配置" if not llm else "未配置: " + ", ".join(llm), "" if not llm else "不影响打开页面, 只影响聊天")


def check_port():
    s = socket.socket()
    s.settimeout(1)
    try:
        if s.connect_ex((HOST, PORT)) == 0:
            show(BAD, f"端口 {PORT} 已被占用", f"关闭上一次没退出的服务窗口, 或改用 --port 8001 启动")
        else:
            show(OK, f"端口 {PORT} 空闲")
    finally:
        s.close()


async def check_mcp():
    from app.mcd_client import McdClient, McdUnavailable
    c = McdClient()
    try:
        r = await c.call("now-time-info")
        show(OK, "麦当劳 MCP 可连接: 服务器时间 " + str((r.get("data") or {}).get("formatted", "?")))
    except McdUnavailable as e:
        show(BAD, "麦当劳 MCP 连不上", str(e))
    finally:
        await c.stop()


def check_proxy():
    p = {k: v for k, v in os.environ.items() if k.lower() in ("http_proxy", "https_proxy", "all_proxy")}
    if p:
        show(WARN, "检测到系统代理环境变量: " + ", ".join(p), "代理不稳定时会连不上 MCP; 可试着临时取消再启动")


def main():
    print(f"项目目录: {ROOT}\n")
    check_python()
    check_dirs()
    check_deps()
    check_env()
    check_proxy()
    check_port()
    if failed == 0 or "--force-mcp" in sys.argv:
        asyncio.run(check_mcp())
    print()
    if failed:
        print(f"共 {failed} 项失败, 请按提示处理后重新运行。")
        sys.exit(1)
    print("全部通过。")
    if "--run" in sys.argv:
        print(f"启动服务: http://{HOST}:{PORT}  (Ctrl+C 退出)")
        os.chdir(ROOT)
        sys.exit(subprocess.call([sys.executable, "-m", "uvicorn", "app.server:app", "--host", HOST, "--port", str(PORT)]))
    print(f"启动命令: python -m uvicorn app.server:app --host {HOST} --port {PORT}")


if __name__ == "__main__":
    main()
