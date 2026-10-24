"""通用 MCP 工具调用: python call_tool.py <tool_name> '<json_args>'

默认拒绝带副作用的工具,需要显式加 --allow-write 才会执行。
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

WRITE_TOOLS = {
    "create-order",
    "cancel-order",
    "mall-create-order",
    "party-order-create",
    "draw-lottery",
    "auto-bind-coupons",
    "delivery-create-address",
}


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


async def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--allow-write"]
    allow_write = "--allow-write" in sys.argv
    name = args[0]
    payload = json.loads(args[1]) if len(args) > 1 else {}

    if name in WRITE_TOOLS and not allow_write:
        sys.exit(f"拒绝: {name} 有副作用,需显式 --allow-write")

    load_env(Path(__file__).parent / ".env")
    headers = {"Authorization": f"Bearer {os.environ['MCD_MCP_TOKEN']}"}
    async with streamablehttp_client(os.environ["MCD_MCP_URL"], headers=headers) as (r, w, _):
        async with ClientSession(r, w) as s:
            await s.initialize()
            res = await s.call_tool(name, payload)
            print("isError:", res.isError)
            if res.structuredContent:
                print(json.dumps(res.structuredContent, ensure_ascii=False, indent=1))
            for c in res.content:
                if getattr(c, "text", None):
                    print(c.text)


if __name__ == "__main__":
    asyncio.run(main())
