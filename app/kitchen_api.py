"""后厨前端(根目录 index.html + js/)使用的接口: 真实菜单 + 结算。

单独成模块, 用工厂函数接入 server.py, 这样 server.py 只需要多一行 include_router,
不会和同时在改 server.py 的其他工作冲突。

安全约束
- 价格永远来自服务端当前门店菜单, 不信任前端传来的价格。
- 前端只能传 (商品 id, 数量); id 必须在"该门店已映射的可点餐品"里。
- 这里只算价, 不下单。下单仍只有 /api/order/confirm(受 DEMO_MODE 拦截)。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .kitchen import build_menu


class Line(BaseModel):
    id: str = Field(max_length=32)
    quantity: int = Field(ge=1, le=20)


class CheckoutReq(BaseModel):
    session_id: str
    items: list[Line] = Field(min_length=1, max_length=40)


def make_router(get_session, calc_price) -> APIRouter:
    """get_session(sid)->Session; calc_price(session)->dict, 失败时含 'error'。由 server.py 绑定 mcd 后传入。"""
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
