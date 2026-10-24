"""连接麦当劳 MCP,列出所有工具及参数 schema(只读,不产生副作用)。"""
import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


async def main() -> None:
    load_env(Path(__file__).parent / ".env")
    url = os.environ["MCD_MCP_URL"]
    headers = {"Authorization": f"Bearer {os.environ['MCD_MCP_TOKEN']}"}

    async with streamablehttp_client(url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print("server:", init.serverInfo.name, init.serverInfo.version)
            print("instructions:", init.instructions)
            tools = await session.list_tools()
            out = [
                {
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": t.inputSchema,
                }
                for t in tools.tools
            ]
            print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
