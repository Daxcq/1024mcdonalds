"""FastAPI 服务: 前端面板 + 点单 agent。

⚠ 本服务没有用户认证, 只绑定 127.0.0.1。MCP token 对应一个真实麦当劳账号,
  上线前必须加登录/会话鉴权, 否则任何能访问的人都能用这个账号下单。
"""
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from openai import APIError
from pydantic import BaseModel, Field

from .agent import Agent
from .mcd_client import McdClient, load_env
from .menu import PANEL_GROUPS, panel_group
from .session import Session
from .tools import run_tool

STATIC = Path(__file__).resolve().parent.parent / "static"
sessions: dict[str, Session] = {}
mcd = McdClient()
agent: Agent | None = None
LLM_ENV = ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL")


@asynccontextmanager
async def lifespan(_: FastAPI):
    global agent
    load_env()
    await mcd.start()
    # LLM 没配置时只关闭对话, 手动点菜单/购物车仍可用
    if all(os.environ.get(k) for k in LLM_ENV):
        agent = Agent(mcd)
    yield
    await mcd.stop()


app = FastAPI(lifespan=lifespan)


def get_session(sid: str) -> Session:
    s = sessions.get(sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    return s


class ChatReq(BaseModel):
    session_id: str
    message: str = Field(min_length=1, max_length=500)


class StoreReq(BaseModel):
    session_id: str
    store_code: str


class CartReq(BaseModel):
    session_id: str
    code: str
    quantity: int = Field(ge=0, le=20)


class ConfirmReq(BaseModel):
    session_id: str
    take_way_code: str


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


@app.post("/api/session")
async def new_session():
    sid = uuid.uuid4().hex
    sessions[sid] = Session(id=sid)
    return {"session_id": sid}


@app.get("/api/stores")
async def stores(city: str, keyword: str):
    return await run_tool("search_stores", {"city": city, "keyword": keyword}, Session(id="tmp"), mcd)


@app.post("/api/store")
async def pick_store(req: StoreReq):
    s = get_session(req.session_id)
    out = await run_tool("select_store", {"store_code": req.store_code}, s, mcd)
    if "error" in out:
        raise HTTPException(400, out["error"])
    return {"state": s.snapshot()}


@app.get("/api/menu")
async def menu(session_id: str):
    s = get_session(session_id)
    groups = [g for g, _ in PANEL_GROUPS]
    by_group: dict[str, list] = {g: [] for g in groups}
    for m in s.menu.values():
        by_group[panel_group(m)].append(m.to_dict())
    return {"groups": groups, "menu": by_group}


@app.post("/api/cart")
async def cart_set(req: CartReq):
    """面板上点 +/- 走这里, 和 agent 共用同一个购物车。"""
    s = get_session(req.session_id)
    m = s.menu.get(req.code)
    if not m:
        raise HTTPException(400, "菜单里没有该餐品")
    if req.code in s.cart.lines:
        s.cart.set_quantity(req.code, req.quantity)
    elif req.quantity > 0:
        s.cart.add(m.code, m.name, m.cart_price, req.quantity)
    s.pending_order = None
    return {"state": s.snapshot()}


@app.post("/api/chat")
async def chat(req: ChatReq):
    s = get_session(req.session_id)
    if agent is None:
        missing = [k for k in LLM_ENV if not os.environ.get(k)]
        raise HTTPException(503, f"对话未启用, .env 缺少: {', '.join(missing)}")
    try:
        return await agent.chat(s, req.message)
    except APIError as e:
        raise HTTPException(502, f"模型调用失败: {e.__class__.__name__}")


@app.post("/api/order/confirm")
async def confirm(req: ConfirmReq):
    """唯一的下单入口: 用户在界面点击确认才会走到这里。"""
    s = get_session(req.session_id)
    p = s.pending_order
    if not s.store or not p:
        raise HTTPException(400, "请先算价再确认下单")
    if p["items"] != s.cart.items_for_mcp():
        s.pending_order = None
        raise HTTPException(409, "购物车已变化, 请重新算价")
    if req.take_way_code not in {t["code"] for t in p["takeWayList"]}:
        raise HTTPException(400, "取餐方式无效")

    r = await mcd.call(
        "create-order",
        {**s.store.scope(), "items": p["items"], "takeWayCode": req.take_way_code},
        allow_write=True,
    )
    if not r.get("success"):
        raise HTTPException(502, r.get("message", "下单失败"))
    s.pending_order = None
    s.cart.clear()
    return {"order": r.get("data"), "message": r.get("message")}
