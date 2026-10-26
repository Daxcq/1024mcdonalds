"""后厨前端(根目录 index.html + js/)使用的接口: 真实菜单 + 结算 + 自动选店。

单独成模块, 用工厂函数接入 server.py, 这样 server.py 只需要多一行 include_router,
不会和同时在改 server.py 的其他工作冲突。

安全约束
- 价格永远来自服务端当前门店菜单, 不信任前端传来的价格。
- 前端只能传 (商品 id, 数量); id 必须在"该门店已映射的可点餐品"里。
- 这里只算价, 不下单。下单仍只有 /api/order/confirm(受 DEMO_MODE 拦截)。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .autostore import MAX_TRIES, rank_stores
from .kitchen import build_menu
from .mcd_client import McdUnavailable

CN = timezone(timedelta(hours=8))   # 门店在中国: 判断"现在是否营业"一律按北京时间, 不依赖服务器所在时区


def now_minutes_cn(clock=None) -> int:
    t = (clock or (lambda: datetime.now(CN)))()
    return t.hour * 60 + t.minute


class Line(BaseModel):
    id: str = Field(max_length=32)
    quantity: int = Field(ge=1, le=20)


class CheckoutReq(BaseModel):
    session_id: str
    items: list[Line] = Field(min_length=1, max_length=40)


class AutoReq(BaseModel):
    session_id: str
    preferred: str | None = Field(default=None, max_length=24)   # 玩家上次手动选的店, 由前端从本地记忆里带上来


def make_router(get_session, calc_price, list_stores, pick_store, clock=None) -> APIRouter:
    """
    get_session(sid) -> Session
    async calc_price(session) -> dict       失败时含 'error'
    list_stores() -> list[dict]            每项含 storeCode / name / hours / burgerCount
    async pick_store(session, code) -> dict  成功返回 {'ok': True}, 失败返回 {'error': 文案}; MCP 整体不可用时抛 McdUnavailable
    clock() -> datetime(带时区)             测试时注入
    """
    r = APIRouter(prefix="/api/kitchen")

    @r.get("/menu")
    async def menu(session_id: str):
        """当前所选门店的真实菜单, 已翻译成后厨动画能执行的商品定义。"""
        s = get_session(session_id)
        if not s.store or not s.menu:
            raise HTTPException(400, "请先选择门店")
        rep = build_menu(list(s.menu.values()))
        return {
            "store": s.store.store_code,
            "items": [it.to_dict() for it in rep.mapped],
            "summary": rep.summary(),
        }

    @r.post("/auto-store")
    async def auto_store(req: AutoReq):
        """自动选一家能点单的店并加载菜单。按"优先级"依次尝试, 取到菜单即停。

        返回 {store, items, tried}; 全部尝试失败时返回 409 并说明原因(而不是 500),
        前端据此保持离线演示菜单并提示"现在可能都已打烊"。
        MCP 整体不可用(网络/token)时直接抛出, 由全局处理器变成 503, 不再逐家重试。"""
        s = get_session(req.session_id)
        known = list_stores()
        order = rank_stores(known, now_minutes_cn(clock), req.preferred, MAX_TRIES)
        tried: list[dict] = []
        for st in order:
            out = await pick_store(s, st["storeCode"])      # McdUnavailable 向上抛, 不吞
            if out.get("error"):
                tried.append({"storeCode": st["storeCode"], "name": st.get("name"), "reason": out["error"]})
                continue
            s.store.name = st.get("name") or s.store.name
            rep = build_menu(list(s.menu.values()))
            return {
                "store": {k: st.get(k) for k in ("storeCode", "name", "address", "hours", "burgerCount")},
                "items": [it.to_dict() for it in rep.mapped],
                "tried": tried,
            }
        raise HTTPException(409, "试了 %d 家门店都取不到菜单，可能现在都已打烊。可以点右上角「选门店」手动选择，或稍后再试。" % len(tried))

    @r.post("/checkout")
    async def checkout(req: CheckoutReq):
        """把前端订单列表同步进会话购物车并算价(含优惠), 返回待确认订单。"""
        s = get_session(req.session_id)
        if not s.store or not s.menu:
            raise HTTPException(400, "请先选择门店")
        allowed = {it.id for it in build_menu(list(s.menu.values())).mapped}

        wanted: dict[str, int] = {}
        for ln in req.items:
            if ln.id not in allowed:
                raise HTTPException(400, "含有当前门店不可点的商品, 请刷新菜单")
            wanted[ln.id] = wanted.get(ln.id, 0) + ln.quantity
        if any(q > 20 for q in wanted.values()):
            raise HTTPException(400, "单品数量过多")

        s.cart.clear()
        for code, qty in wanted.items():
            m = s.menu[code]
            s.cart.add(m.code, m.name, m.cart_price, qty)
        s.pending_order = None

        out = await calc_price(s)
        if "error" in out:
            raise HTTPException(400, out["error"])
        return {"state": s.snapshot(), "estimate": s.cart.total()}

    return r
