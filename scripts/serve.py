"""云端启动入口: 监听 0.0.0.0 与 $PORT, 供发布平台/PaaS 使用。

本地双击启动仍然走 start.bat -> scripts/launcher.py(只监听 127.0.0.1)。
两者跑的是同一个 app.server:app, 区别只在 host / port 的来源。

用法: python scripts/serve.py
环境变量: PORT(默认 8000)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 以脚本方式启动时 sys.path[0] 是 scripts/, 这里补上项目根, 否则 import app.server 会失败
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("app.server:app", host="0.0.0.0", port=port, log_level="info")
