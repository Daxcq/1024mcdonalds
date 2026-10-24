"""麦当劳 MCP 客户端封装: 长连接 + 响应解析 + 写操作闸门。"""
import json
import os
from contextlib import AsyncExitStack
from pathlib import Path

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

ROOT = Path(__file__).resolve().parent.parent

# 有副作用的工具: 只有显式 allow_write=True 才放行。
# agent 的工具箱里不包含这些, 只有 server 的"确认下单"接口会放行 create-order。
WRITE_TOOLS = {
    "create-order",
    "cancel-order",
    "mall-create-order",
    "party-order-create",
    "draw-lottery",
    "auto-bind-coupons",
    "delivery-create-address",
}


def load_env(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def parse_payload(res) -> dict:
    """MCP 返回 JSON 之后会拼一段给 LLM 看的说明文本, 这里只取 JSON 本体。"""
    if res.structuredContent:
        return res.structuredContent
    for c in res.content:
        text = getattr(c, "text", None) or ""
        i = text.find("{")
        if i >= 0:
            try:
                obj, _ = json.JSONDecoder().raw_decode(text[i:])
                return obj
            except json.JSONDecodeError:
                continue
    return {"success": False, "message": "无法解析 MCP 返回"}


class McdClient:
    def __init__(self) -> None:
        load_env()
        self.url = os.environ["MCD_MCP_URL"]
        self._headers = {"Authorization": f"Bearer {os.environ['MCD_MCP_TOKEN']}"}
        self._stack = AsyncExitStack()
        self._session: ClientSession | None = None

    async def start(self) -> None:
        r, w, _ = await self._stack.enter_async_context(
            streamablehttp_client(self.url, headers=self._headers)
        )
        self._session = await self._stack.enter_async_context(ClientSession(r, w))
        await self._session.initialize()

    async def stop(self) -> None:
        await self._stack.aclose()

    async def call(self, name: str, args: dict | None = None, allow_write: bool = False) -> dict:
        if name in WRITE_TOOLS and not allow_write:
            raise PermissionError(f"{name} 有副作用, 未授权调用")
        assert self._session is not None, "McdClient 未启动"
        res = await self._session.call_tool(name, args or {})
        return parse_payload(res)
