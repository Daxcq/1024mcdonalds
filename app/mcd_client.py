"""麦当劳 MCP 客户端封装: 懒连接 + 断线重连 + 响应解析 + 写操作闸门。

设计要点
- 启动服务时不连接 MCP。静态页面不依赖 MCP, 不能因为 MCP 暂时不可达就整站打不开。
- 第一次真正调用时才建立连接; 连接断开或调用失败后, 下一次调用会自动重建。
- 连接的建立、使用、关闭都在同一个后台任务里完成。anyio 的取消作用域不能跨任务退出,
  在请求任务里进入、在别的任务里退出会触发 "exit cancel scope in a different task"。
- 对外只抛 McdUnavailable, 由接口层转成用户能看懂的提示。
"""
import asyncio
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

CONNECT_TIMEOUT = 20   # 建立连接最长等待(秒)
CALL_TIMEOUT = 40      # 单次工具调用最长等待(秒)


class McdUnavailable(RuntimeError):
    """MCP 连不上或调用超时。message 可直接展示给用户。"""


def load_env(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():  # utf-8-sig: 兼容记事本保存带 BOM 的文件
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


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
        self.url = os.environ.get("MCD_MCP_URL", "")
        self._token = os.environ.get("MCD_MCP_TOKEN", "")
        self._session: ClientSession | None = None
        self._runner: asyncio.Task | None = None
        self._ready: asyncio.Event | None = None
        self._stop: asyncio.Event | None = None
        self._lock: asyncio.Lock | None = None
        self.last_error = ""

    # ---------- 状态 ----------
    @property
    def configured(self) -> bool:
        return bool(self.url and self._token)

    @property
    def connected(self) -> bool:
        return self._session is not None and self._runner is not None and not self._runner.done()

    # ---------- 连接生命周期 ----------
    async def start(self) -> None:
        """服务启动时调用: 只做准备, 不连接。保留这个方法是为了兼容旧调用方(脚本里 await m.start())。"""
        await self._ensure()

    async def stop(self) -> None:
        if self._stop is not None:
            self._stop.set()
        if self._runner is not None:
            try:
                await asyncio.wait_for(self._runner, timeout=5)
            except (asyncio.TimeoutError, Exception):
                self._runner.cancel()
        self._session = None
        self._runner = None

    async def _run(self) -> None:
        """后台任务: 连接 -> 通知就绪 -> 等待停止。进入和退出都在本任务内。"""
        stack = AsyncExitStack()
        try:
            r, w, _ = await stack.enter_async_context(
                streamablehttp_client(self.url, headers={"Authorization": f"Bearer {self._token}"})
            )
            sess = await stack.enter_async_context(ClientSession(r, w))
            await sess.initialize()
            self._session = sess
            self.last_error = ""
            self._ready.set()
            await self._stop.wait()
        except BaseException as e:  # noqa: BLE001 - 需要同时捕获取消和异常组
            self.last_error = _brief(e)
            raise
        finally:
            self._session = None
            self._ready.set()  # 失败时也要唤醒等待者, 让它们看到 _session is None
            try:
                await stack.aclose()
            except BaseException:  # noqa: BLE001
                pass

    async def _probe(self) -> str:
        """建连前先探测一次, 拿到真实原因。

        streamablehttp_client 在连接失败时会吞掉真正的异常(ConnectError / 401),
        只向外抛 CancelledError, 用户看到的就是一句看不懂的话。
        这里用 httpx 发一个最小的 initialize 请求, 只用来分类错误; 返回空串表示可以继续建连。"""
        import httpx

        body = {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "probe", "version": "0"}}}
        headers = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream"}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(CONNECT_TIMEOUT, connect=10)) as c:
                r = await c.post(self.url, json=body, headers=headers)
        except httpx.ConnectError:
            return f"网络连不上 {self.url}(检查网络、代理或 MCD_MCP_URL 是否正确)"
        except httpx.TimeoutException:
            return f"连接 {self.url} 超时(检查网络或代理)"
        except httpx.InvalidURL:
            return f"MCD_MCP_URL 格式不对: {self.url}"
        except httpx.HTTPError as e:
            return f"网络错误 {type(e).__name__}"
        if r.status_code in (401, 403):
            return f"麦当劳拒绝了 token(HTTP {r.status_code}): 检查 MCD_MCP_TOKEN 是否正确、是否过期"
        if r.status_code >= 500:
            return f"麦当劳 MCP 服务端错误(HTTP {r.status_code}), 稍后再试"
        if r.status_code == 404:
            return "MCD_MCP_URL 路径不对(HTTP 404)"
        return ""

    async def _ensure(self) -> ClientSession:
        if not self.configured:
            raise McdUnavailable("没有配置麦当劳 MCP(检查 .env 里的 MCD_MCP_URL 和 MCD_MCP_TOKEN)")
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            if not self.connected:
                why = await self._probe()
                if why:
                    self.last_error = why
                    raise McdUnavailable(why)
                self._ready, self._stop = asyncio.Event(), asyncio.Event()
                self._session = None
                self._runner = asyncio.create_task(self._run(), name="mcd-mcp")
                try:
                    await asyncio.wait_for(self._ready.wait(), timeout=CONNECT_TIMEOUT)
                except asyncio.TimeoutError:
                    self._runner.cancel()
                    self.last_error = f"连接 {self.url} 超时({CONNECT_TIMEOUT}s)"
                if self._session is None:
                    self._runner = None
                    raise McdUnavailable(f"连不上麦当劳 MCP: {self.last_error or '未知原因'}")
            return self._session

    async def call(self, name: str, args: dict | None = None, allow_write: bool = False) -> dict:
        if name in WRITE_TOOLS and not allow_write:
            raise PermissionError(f"{name} 有副作用, 未授权调用")
        sess = await self._ensure()
        try:
            res = await asyncio.wait_for(sess.call_tool(name, args or {}), timeout=CALL_TIMEOUT)
        except asyncio.TimeoutError:
            await self._reset(f"调用 {name} 超时({CALL_TIMEOUT}s)")
            raise McdUnavailable(f"麦当劳接口响应太慢, 请稍后再试({name})")
        except Exception as e:  # 连接可能已断: 丢弃当前连接, 下次调用重建
            await self._reset(_brief(e))
            raise McdUnavailable(f"麦当劳接口暂时不可用: {self.last_error}")
        return parse_payload(res)

    async def _reset(self, why: str) -> None:
        self.last_error = why
        if self._stop is not None:
            self._stop.set()
        self._session = None
        self._runner = None


def _leaves(e: BaseException):
    """展开 ExceptionGroup, 依次产出所有叶子异常。"""
    subs = getattr(e, "exceptions", None)
    if subs:
        for s in subs:
            yield from _leaves(s)
    else:
        yield e


_FRIENDLY = (
    ("ConnectError", "网络连不上(检查网络或 MCD_MCP_URL 是否正确)"),
    ("ConnectTimeout", "连接超时(检查网络)"),
    ("ReadTimeout", "读取超时(检查网络)"),
    ("HTTPStatusError", "服务返回了错误状态(检查 MCD_MCP_TOKEN 是否有效、是否过期)"),
)


def _brief(e: BaseException) -> str:
    """把异常(含 ExceptionGroup)压成一行能看懂的提示。
    取消类异常(CancelledError)只是连锁反应, 不是根因, 优先挑真正的错误。"""
    leaves = list(_leaves(e))
    real = [x for x in leaves if type(x).__name__ not in ("CancelledError", "GeneratorExit")] or leaves
    leaf = real[0]
    name = type(leaf).__name__
    for key, text in _FRIENDLY:
        if key in name:
            return f"{text} [{name}]"
    msg = str(leaf).strip().splitlines()[0][:120] if str(leaf).strip() else ""
    return f"{name}: {msg}" if msg else name
