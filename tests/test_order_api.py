"""下单闭环测试: 所有麦当劳接口均为内存假实现, 不创建真实订单。"""
import asyncio
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.mcd_client import McdUnavailable
from app.order_api import ConfirmReq, make_router
from app.session import Session, Store
from app.tools import run_tool


class FakeMcd:
    def __init__(self):
        self.calls = []
        self.status = "待支付"
        self.replies = {}
        self.hook = None

    async def call(self, name, args=None, allow_write=False):
        self.calls.append((name, args, allow_write))
        if self.hook:
            await self.hook(name)
        if name in self.replies:
            value = self.replies[name]
            if isinstance(value, Exception):
                raise value
            return value
        if name == "create-order":
            return {"success": True, "data": {"orderId": "O1", "payH5Url": "https://pay.example.test/order/O1", "orderStatusName": self.status}}
        if name == "query-order":
            return {"success": True, "data": {"orderId": "O1", "orderStatusName": self.status}}
        if name == "cancel-order":
            self.status = "已取消"
            return {"success": True}
        if name == "calculate-price":
            return {"success": True, "data": {"originalPrice": 900, "price": 800, "discount": 100,
                    "takeWayList": [{"code": "TAKE", "title": "打包带走"}]}}
        raise AssertionError(name)


def setup():
    s = Session(id="t", store=Store("X1", "测试门店"))
    s.cart.add("P1", "测试餐品", 9.0, 1)
    mcd = FakeMcd()
    asyncio.run(run_tool("calculate_price", {}, s, mcd))
    mcd.calls.clear()
    app = FastAPI()
    demo = [False]

    def get_session(sid):
        if sid != s.id:
            raise HTTPException(404, "会话已过期")
        return s

    @app.exception_handler(McdUnavailable)
    async def unavailable(req, e):
        return JSONResponse(status_code=503, content={"detail": str(e)})

    app.include_router(make_router(get_session, lambda: mcd, lambda: demo[0]))
    return TestClient(app), s, mcd, demo


class OrderApiTest(unittest.TestCase):
    def setUp(self):
        self.c, self.s, self.m, self.demo = setup()
        self.payload = {"session_id": "t", "take_way_code": "TAKE", "quote_id": self.s.pending_order["quote_id"]}

    def create(self):
        return self.c.post("/api/order/confirm", json=self.payload)

    def status(self):
        return self.c.get("/api/order/status", params={"session_id": "t"})

    def cancel(self, **kw):
        return self.c.post("/api/order/cancel", json={"session_id": "t", "order_id": "O1", **kw})

    def test_确认支付链接查询取消完整闭环(self):
        self.assertEqual(self.c.get("/api/order?session_id=t").json()["order"], None)
        r = self.create()
        self.assertEqual(r.status_code, 200, r.text)
        o = r.json()["order_state"]
        self.assertEqual(o["id"], "O1")
        self.assertEqual(o["pay_url"], "https://pay.example.test/order/O1")
        self.assertEqual(o["price"], 8)
        self.assertFalse(self.s.cart.lines)
        self.assertIsNone(self.s.pending_order)
        self.assertEqual(self.status().json()["order"]["status_text"], "待支付")
        self.m.status = "已支付"
        self.assertEqual(self.status().json()["order"]["status_text"], "已支付")
        r = self.cancel(reason_code="3")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["order"]["status_text"], "已取消")
        self.assertTrue(r.json()["order"]["terminal"])
        self.assertIn(("cancel-order", {"orderId": "O1", "cancelReasonCode": "3"}, True), self.m.calls)
        self.assertEqual(self.c.get("/api/order?session_id=t").json()["order"]["id"], "O1")

    def test_演示模式拒绝真实创建(self):
        self.demo[0] = True
        self.assertEqual(self.create().status_code, 403)
        self.assertEqual(self.m.calls, [])

    def test_报价或购物车过期不能下单(self):
        for change in ("quote", "cart", "store"):
            c, s, m, _ = setup()
            payload = {**self.payload, "quote_id": s.pending_order["quote_id"]}
            if change == "quote":
                payload["quote_id"] = "old"
            elif change == "cart":
                s.cart.set_quantity("P1", 2)
            else:
                s.store = Store("X2", "另一家店")
            self.assertEqual(c.post("/api/order/confirm", json=payload).status_code, 409)
            self.assertEqual(m.calls, [])

    def test_无效取餐方式拒绝且购物车保留(self):
        self.payload["take_way_code"] = "BAD"
        self.assertEqual(self.create().status_code, 400)
        self.assertTrue(self.s.cart.lines)
        self.assertEqual(self.m.calls, [])

    def test_同报价重复请求只创建一次(self):
        self.assertEqual(self.create().status_code, 200)
        self.assertEqual(self.create().status_code, 200)
        self.assertEqual(sum(n == "create-order" for n, _, _ in self.m.calls), 1)

    def test_当前订单未结束不能再下新订单(self):
        self.create()
        self.s.cart.add("P1", "测试餐品", 9.0, 1)
        asyncio.run(run_tool("calculate_price", {}, self.s, self.m))
        self.payload["quote_id"] = self.s.pending_order["quote_id"]
        self.assertEqual(self.create().status_code, 409)
        self.cancel()
        self.assertEqual(self.create().status_code, 200)

    def test_下单失败保留购物车且可重试(self):
        self.m.replies["create-order"] = {"success": False, "message": "已售罄"}
        self.assertEqual(self.create().status_code, 502)
        self.assertTrue(self.s.cart.lines)
        self.assertFalse(self.s.order_uncertain)
        del self.m.replies["create-order"]
        self.assertEqual(self.create().status_code, 200)

    def test_下单超时或缺订单号禁止重复创建(self):
        for value in (McdUnavailable("timeout"), {"success": True, "data": {}}, {}):
            self.c, self.s, self.m, _ = setup()
            self.payload["quote_id"] = self.s.pending_order["quote_id"]
            self.m.replies["create-order"] = value
            self.assertIn(self.create().status_code, (502, 503))
            self.assertTrue(self.s.order_uncertain)
            self.assertTrue(self.s.cart.lines)
            self.assertEqual(self.create().status_code, 409)
            self.assertEqual(sum(n == "create-order" for n, _, _ in self.m.calls), 1)

    def test_订单只允许当前会话访问(self):
        self.create()
        self.assertEqual(self.cancel(order_id="OTHER").status_code, 404)
        self.assertEqual(self.c.get("/api/order/status?session_id=other").status_code, 404)
        self.assertFalse(any(n == "cancel-order" for n, _, _ in self.m.calls))

    def test_取消失败仍保留订单并允许重试(self):
        self.create()
        self.m.replies["cancel-order"] = {"success": False, "message": "暂时不能取消"}
        self.assertEqual(self.cancel().status_code, 502)
        self.assertEqual(self.s.order["id"], "O1")
        self.assertFalse(self.s.order["cancel_requested"])
        del self.m.replies["cancel-order"]
        self.assertEqual(self.cancel().json()["order"]["status_text"], "已取消")

    def test_取消后查询失败不误报最终成功也不重复取消(self):
        self.create()
        self.m.replies["query-order"] = McdUnavailable("timeout")
        r = self.cancel()
        self.assertIn("warning", r.json())
        self.assertEqual(r.json()["order"]["status_text"], "待支付")
        self.assertEqual(self.cancel().status_code, 200)
        self.assertEqual(sum(n == "cancel-order" for n, _, _ in self.m.calls), 1)
        del self.m.replies["query-order"]
        self.assertEqual(self.status().json()["order"]["status_text"], "已取消")

    def test_取消超时可继续查询且不会自动重试(self):
        self.create()
        self.m.replies["cancel-order"] = McdUnavailable("timeout")
        self.assertIn("warning", self.cancel().json())
        self.cancel()
        self.assertEqual(sum(n == "cancel-order" for n, _, _ in self.m.calls), 1)
        self.m.status = "已取消"
        self.assertEqual(self.status().json()["order"]["status_text"], "已取消")

    def test_查询失败保留上次状态(self):
        self.create()
        self.m.replies["query-order"] = {"success": False, "message": "暂时不可用"}
        self.assertEqual(self.status().status_code, 502)
        self.assertEqual(self.s.order["status_text"], "待支付")

    def test_不信任错误订单号和支付脚本链接(self):
        self.m.replies["create-order"] = {"success": True, "data": {"orderId": "O1", "payH5Url": "javascript:alert(1)"}}
        self.assertEqual(self.create().json()["order_state"]["pay_url"], "")
        self.m.replies["query-order"] = {"success": True, "data": {"orderId": "OTHER"}}
        self.assertEqual(self.status().status_code, 502)
        self.assertEqual(self.s.order["data"]["orderId"], "O1")

    def test_未知数字状态不当成已支付或已取消(self):
        self.m.replies["create-order"] = {"success": True, "data": {"orderId": "O1", "orderStatus": 99}}
        o = self.create().json()["order_state"]
        self.assertEqual(o["status_text"], "99")
        self.assertFalse(o["terminal"])

    def test_取消原因只允许接口提供的值(self):
        self.create()
        self.assertEqual(self.cancel(reason_code="invented").status_code, 422)
        self.assertFalse(any(n == "cancel-order" for n, _, _ in self.m.calls))


class ConcurrentOrderTest(unittest.IsolatedAsyncioTestCase):
    async def test_等待创建期间拒绝并发确认且不清除后来修改的购物车(self):
        _, s, m, _ = setup()
        router = make_router(lambda sid: s, lambda: m, lambda: False)
        endpoint = next(r.endpoint for r in router.routes if r.path == "/api/order/confirm")
        ready, release = asyncio.Event(), asyncio.Event()

        async def wait(name):
            if name == "create-order":
                ready.set()
                await release.wait()

        m.hook = wait
        req = ConfirmReq(session_id="t", quote_id=s.pending_order["quote_id"], take_way_code="TAKE")
        first = asyncio.create_task(endpoint(req))
        await ready.wait()
        with self.assertRaises(HTTPException) as cm:
            await endpoint(req)
        self.assertEqual(cm.exception.status_code, 409)
        s.cart.set_quantity("P1", 2)
        release.set()
        await first
        self.assertEqual(s.cart.lines["P1"].quantity, 2)
        self.assertEqual(sum(n == "create-order" for n, _, _ in m.calls), 1)


if __name__ == "__main__":
    unittest.main()
