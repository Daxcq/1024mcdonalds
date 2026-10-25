"""真实下单闭环。只允许操作当前会话创建的订单, 写请求绝不自动重试。"""
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .mcd_client import McdUnavailable


class ConfirmReq(BaseModel):
    session_id: str
    quote_id: str = Field(min_length=1)
    take_way_code: str


class CancelReq(BaseModel):
    session_id: str
    order_id: str
    reason_code: Literal["1", "2", "3", "4", "5", "-1"] = "1"


def _pay_url(data):
    value = data.get("payH5Url") or ""
    if not isinstance(value, str):
        return ""
    try:
        url = urlsplit(value)
        return value if url.scheme in ("http", "https") and url.hostname and not url.username else ""
    except ValueError:
        return ""


def _update(order, data):
    # 没有上游的状态码字典, 不猜测数字码的含义。
    order["data"].update(data)
    d = order["data"]
    status = next((d[k] for k in ("orderStatusName", "orderStatusDesc", "statusName", "statusDesc", "orderStatus", "status")
                   if d.get(k) is not None and d[k] != ""), None)
    order["status_text"] = str(status) if status is not None else "待查询（以麦当劳官方状态为准）"
    order["terminal"] = str(status).strip().lower() in {
        "已取消", "订单已取消", "已完成", "订单已完成", "已关闭", "订单已关闭", "cancelled", "canceled", "completed", "closed",
    }
    order["pay_url"] = _pay_url(d)
    order["updated_at"] = datetime.now(timezone.utc).isoformat()


def make_router(get_session, get_mcd, is_demo):
    r = APIRouter(prefix="/api/order")

    def current(s, order_id=None):
        if not s.order or (order_id is not None and order_id != s.order["id"]):
            raise HTTPException(404, "当前会话没有这笔订单")
        return s.order

    async def query(s):
        o = current(s)
        res = await get_mcd().call("query-order", {"orderId": o["id"]})
        if not res.get("success") or not isinstance(res.get("data"), dict):
            raise HTTPException(502, res.get("message") or "查询订单失败")
        data = res["data"]
        if data.get("orderId") is not None and str(data["orderId"]) != o["id"]:
            raise HTTPException(502, "返回的订单号不匹配, 请前往麦当劳 App 核实")
        _update(o, data)
        return o

    @r.get("")
    async def saved(session_id: str):
        s = get_session(session_id)
        return {"order": s.order, "uncertain": s.order_uncertain, "busy": s.order_busy}

    @r.get("/status")
    async def status(session_id: str):
        s = get_session(session_id)
        if s.order_busy:
            raise HTTPException(409, "订单正在处理中, 请稍后查询")
        s.order_busy = True
        try:
            return {"order": await query(s)}
        finally:
            s.order_busy = False

    @r.post("/confirm")
    async def confirm(req: ConfirmReq):
        if is_demo():
            raise HTTPException(403, "当前是演示模式, 真实下单未开启。请在 .env 设置 DEMO_MODE=0 后重启服务")
        s = get_session(req.session_id)
        # 同一报价的请求重放只返回原订单, 即使购物车已经清空也不重新创建。
        if s.order and s.order["quote_id"] == req.quote_id:
            return {"order": s.order["data"], "order_state": s.order}
        if s.order_busy:
            raise HTTPException(409, "订单正在处理中, 请勿重复提交")
        if s.order_uncertain:
            raise HTTPException(409, "上次下单结果不确定, 请先到麦当劳 App 查看订单, 不要重复下单")
        if s.order and not s.order["terminal"]:
            raise HTTPException(409, "请先处理当前订单并刷新状态, 再创建新订单")
        p = s.pending_order
        if not s.store or not p:
            raise HTTPException(400, "请先算价再确认下单")
        if p.get("quote_id") != req.quote_id:
            raise HTTPException(409, "报价已变化, 请重新结算并确认")
        if p["items"] != s.cart.items_for_mcp() or p["store"] != s.store.__dict__:
            s.pending_order = None
            raise HTTPException(409, "购物车或门店已变化, 请重新算价")
        ways = {str(t["code"]): t["title"] for t in p["takeWayList"]}
        if req.take_way_code not in ways:
            raise HTTPException(400, "取餐方式无效")
        s.order_busy = True
        try:
            try:
                res = await get_mcd().call("create-order", {
                    **s.store.scope(), "items": p["items"], "takeWayCode": req.take_way_code,
                }, allow_write=True)
            except McdUnavailable:
                s.order_uncertain = True
                raise McdUnavailable("下单请求中断, 结果不确定。请到麦当劳 App 查看订单, 不要重复下单")
            if res.get("success") is False:
                raise HTTPException(502, res.get("message") or "下单失败")
            data = res.get("data")
            if not res.get("success") or not isinstance(data, dict) or not data.get("orderId"):
                s.order_uncertain = True
                raise HTTPException(502, "下单响应缺少订单号, 结果不确定。请到麦当劳 App 查看, 不要重复下单")
            o = {"id": str(data["orderId"]), "quote_id": req.quote_id, "data": {},
                 "store": p["store"], "price": p["price"], "lines": p["lines"],
                 "take_way": ways[req.take_way_code], "cancel_requested": False}
            _update(o, data)
            s.order = o
            if s.pending_order is p:
                s.pending_order = None
            if s.store and s.store.__dict__ == p["store"] and s.cart.items_for_mcp() == p["items"]:
                s.cart.clear()
            return {"order": data, "order_state": o, "message": res.get("message")}
        finally:
            s.order_busy = False

    @r.post("/cancel")
    async def cancel(req: CancelReq):
        s = get_session(req.session_id)
        o = current(s, req.order_id)
        if s.order_busy:
            raise HTTPException(409, "订单正在处理中, 请勿重复提交")
        if o["terminal"] or o["cancel_requested"]:
            return {"order": o, "message": "请刷新订单状态确认结果"}
        s.order_busy = True
        try:
            try:
                res = await get_mcd().call("cancel-order", {
                    "orderId": o["id"], "cancelReasonCode": req.reason_code,
                }, allow_write=True)
            except McdUnavailable:
                # 取消可能已生效; 保留订单, 让用户查状态而不是重复写入。
                o["cancel_requested"] = True
                return {"order": o, "warning": "取消请求中断, 结果不确定。请刷新状态或到麦当劳 App 核实"}
            if not res.get("success"):
                raise HTTPException(502, res.get("message") or "取消失败, 请刷新订单状态后重试")
            o["cancel_requested"] = True
            try:
                await query(s)
            except (McdUnavailable, HTTPException):
                return {"order": o, "warning": "取消请求已提交, 但暂时无法查询最终状态。请稍后刷新或到麦当劳 App 核实"}
            return {"order": o, "message": "取消请求已提交, 请以最新订单状态为准"}
        finally:
            s.order_busy = False

    return r
