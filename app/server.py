"""FastAPI 服务: 前端面板 + 点单 agent。

⚠ 本服务没有用户认证, 只绑定 127.0.0.1。MCP token 对应一个真实麦当劳账号,
  上线前必须加登录/会话鉴权, 否则任何能访问的人都能用这个账号下单。
"""
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import APIError
from pydantic import BaseModel, Field

from .agent import Agent
from .burger import get_engine
from .burger.game import parse_selection, pick_exact, state_json
from .kitchen_api import make_router as make_kitchen_router
from .mcd_client import McdClient, McdUnavailable, load_env
from .menu import PANEL_GROUPS, panel_group
from .order_api import make_router as make_order_router
from .session import Session
from .session_store import SessionStore
from .tools import run_tool

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
# 带过期(默认 2 小时未使用)和数量上限(默认 500)的会话存储, 见 app/session_store.py
sessions: SessionStore[Session] = SessionStore(
    ttl=float(os.environ.get("SESSION_TTL_SECONDS", 2 * 3600)),
    max_sessions=int(os.environ.get("MAX_SESSIONS", 500)),
)
mcd = McdClient()
agent: Agent | None = None
LLM_ENV = ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL")
load_env()
# 演示模式默认开启: 只能算价, 服务端拒绝 create-order。要真实下单必须显式设 DEMO_MODE=0
DEMO_MODE = os.environ.get("DEMO_MODE", "1") != "0"


@asynccontextmanager
async def lifespan(_: FastAPI):
    global agent
    load_env()
    # 不在启动时连接 MCP(懒连接): 麦当劳接口暂时连不上, 也不能让整个网页打不开。
    # LLM 没配置时只关闭对话, 手动点菜单/购物车仍可用
    if all(os.environ.get(k) for k in LLM_ENV):
        agent = Agent(mcd)
    yield
    await mcd.stop()


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def _no_stale_frontend(request: Request, call_next):
    """页面、脚本、接口每次都让浏览器向服务器确认是否有更新(no-cache = 可缓存但必须校验)。
    不设置的话, 浏览器会按 Last-Modified 自行猜一个缓存时长, 前端改了也可能一直显示旧版本。
    大体积的素材图(/assets)内容基本不变, 保持浏览器默认缓存。"""
    resp = await call_next(request)
    p = request.url.path
    if p == "/" or p.startswith(("/js/", "/api/", "/workshop", "/npc")):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.exception_handler(McdUnavailable)
async def _mcd_unavailable(_: Request, e: McdUnavailable):
    # 接口层统一把"麦当劳接口不可用"变成 503 + 可直接展示给用户的提示
    return JSONResponse(status_code=503, content={"detail": str(e)})

# 远端前端(index.html)引用 js/ 和 assets/。只挂这两个目录, 绝不把项目根挂出去,
# 否则 .env(含 MCP token 与模型 key)、data/、app/ 源码都能被直接下载。
app.mount("/js", StaticFiles(directory=ROOT / "js"), name="js")
app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")


def get_session(sid: str) -> Session:
    s = sessions.get(sid)
    if not s:
        # 会话过期或服务重启后都会走到这里; 前端据此提示"刷新页面"
        raise HTTPException(404, "会话已过期, 请刷新页面重新开始")
    return s


async def _calc_price(s: Session) -> dict:
    return await run_tool("calculate_price", {}, s, mcd)


async def _pick_store(s: Session, code: str) -> dict:
    return await run_tool("select_store", {"store_code": code}, s, mcd)


# 后厨前端用的真实菜单 + 结算 + 自动选店接口(见 app/kitchen_api.py)
app.include_router(make_kitchen_router(get_session, _calc_price, lambda: _known_stores(), _pick_store))


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


class ResumeReq(BaseModel):
    session_id: str | None = None


class Ingr(BaseModel):
    name: str = Field(max_length=20)
    kind: str


class BurgerStateReq(BaseModel):
    session_id: str | None = None
    selected: list[Ingr] = Field(default_factory=list, max_length=30)


class BurgerAddReq(BaseModel):
    session_id: str
    selected: list[Ingr] = Field(max_length=30)
    code: str
    quantity: int = Field(default=1, ge=1, le=10)


@app.get("/")
async def index():
    # 标准前端是仓库根目录的 index.html(后厨动画); 拼汉堡工坊页仍在 /workshop
    return FileResponse(ROOT / "index.html")


@app.get("/workshop")
async def workshop():
    return FileResponse(STATIC / "burger-workshop.html")


@app.post("/api/session")
async def new_session(req: ResumeReq | None = None):
    s = sessions.get(req.session_id) if req and req.session_id else None
    if s is None:
        sid = uuid.uuid4().hex
        s = Session(id=sid)
        sessions.put(sid, s)
    return {"session_id": s.id}


@app.get("/api/stores")
async def stores(city: str, keyword: str):
    return await run_tool("search_stores", {"city": city, "keyword": keyword}, Session(id="tmp"), mcd)


def _known_stores() -> list[dict]:
    """已离线整理的长春门店, 只保留配方表里确有汉堡数据的店, 并附上可玩汉堡数。"""
    eng = get_engine()
    path = Path(__file__).resolve().parent.parent / "data" / "stores_changchun.json"
    known = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for st in known:
        n = len(eng.recipes_at(st["storeCode"]))
        if n:
            out.append({"storeCode": st["storeCode"], "name": st["name"], "address": st.get("address"),
                        "hours": st.get("hours"), "burgerCount": n})
    out.sort(key=lambda x: -x["burgerCount"])
    return out


@app.get("/api/city/stores")
async def city_stores():
    return {"stores": _known_stores()}


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


@app.post("/api/burger/state")
async def burger_state(req: BurgerStateReq):
    """玩家每点一次食材就调一次: 纯本地规则, 不联网、不调模型。"""
    store = None
    if req.session_id:
        s = get_session(req.session_id)
        store = s.store.store_code if s.store else None
    sel = parse_selection([i.model_dump() for i in req.selected])
    return state_json(get_engine(), sel, store)


@app.post("/api/burger/add")
async def burger_add(req: BurgerAddReq):
    """拼好的汉堡加入购物车。以服务端重新校验为准, 不信任前端传来的"已拼成"。"""
    s = get_session(req.session_id)
    if not s.store:
        raise HTTPException(400, "请先选择门店")
    sel = parse_selection([i.model_dump() for i in req.selected])
    recipe = pick_exact(get_engine(), sel, s.store.store_code, req.code)
    if not recipe:
        raise HTTPException(409, "当前选择没有拼成这款汉堡")
    # 价格和名称以实时菜单为准; 配方快照可能已过期
    m = s.menu.get(recipe.code)
    if not m:
        raise HTTPException(409, "这款汉堡当前菜单里已下架")
    s.cart.add(m.code, m.name, m.cart_price, req.quantity)
    s.pending_order = None
    return {"state": s.snapshot(), "burger": m.name, "price": m.cart_price}


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


class SidReq(BaseModel):
    session_id: str


@app.post("/api/calc")
async def calc(req: SidReq):
    """只算价, 不下单。与 agent 的 calculate_price 同一实现。"""
    s = get_session(req.session_id)
    out = await run_tool("calculate_price", {}, s, mcd)
    if "error" in out:
        raise HTTPException(400, out["error"])
    return {"state": s.snapshot()}


@app.get("/api/config")
async def config():
    return {"demo": DEMO_MODE, "chat": agent is not None}


app.include_router(make_order_router(get_session, lambda: mcd, lambda: DEMO_MODE))
