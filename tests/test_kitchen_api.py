"""后厨接口测试: 用假的 session 和假的算价函数, 不联网。

运行(项目根目录): python -m unittest tests.test_kitchen_api -v
"""
import asyncio
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.cart import Cart
from app.kitchen_api import make_router
from app.menu import Meal
from app.session import Session, Store


def make_app(menu):
    s = Session(id="t")
    s.store = Store(store_code="X1", name="X1")
    s.menu = {m.code: m for m in menu}
    sessions = {"t": s}

    def get_session(sid):
        if sid not in sessions:
            raise HTTPException(404, "会话不存在")
        return sessions[sid]

    calls = []

    async def calc(sess):
        calls.append(sess.cart.items_for_mcp())
        if not sess.cart.lines:
            return {"error": "购物车是空的"}
        sess.pending_order = {"price": sess.cart.total() - 1, "discount": 1.0, "takeWayList": [], "items": sess.cart.items_for_mcp()}
        return {"ok": True}

    async def no_pick(sess, code):          # 结算接口用不到选店
        raise AssertionError("结算不应触发选店")

    app = FastAPI()
    app.include_router(make_router(get_session, calc, lambda: [], no_pick))
    return TestClient(app), s, calls


MENU = [
    Meal(code="1100", name="巨无霸", price=26.0, original_price=26.0),
    Meal(code="5", name="可乐", price=9.5, original_price=9.5),
    Meal(code="77", name="巨无霸三件套", price=37.0, original_price=37.0),          # 套餐: 不可点
    Meal(code="88", name="龙焰鸡腿堡", price=15.9, original_price=24.0, tags=["麦金卡"]),  # 会员价: 不可点
]


class KitchenApiTest(unittest.TestCase):
    def test_菜单只含可映射的商品(self):
        c, s, _ = make_app(MENU)
        d = c.get("/api/kitchen/menu", params={"session_id": "t"}).json()
        ids = {i["id"] for i in d["items"]}
        self.assertEqual(ids, {"1100", "5"})

    def test_未选店返回400(self):
        c, s, _ = make_app(MENU)
        s.store = None
        self.assertEqual(c.get("/api/kitchen/menu", params={"session_id": "t"}).status_code, 400)

    def test_结算价格来自服务端不是前端(self):
        c, s, calls = make_app(MENU)
        r = c.post("/api/kitchen/checkout", json={"session_id": "t", "items": [{"id": "1100", "quantity": 2}, {"id": "5", "quantity": 1}]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["estimate"], 61.5)  # 26*2 + 9.5, 由服务端菜单算出
        self.assertEqual(r.json()["state"]["pending"]["price"], 60.5)

    def test_合并相同商品的数量(self):
        c, s, calls = make_app(MENU)
        c.post("/api/kitchen/checkout", json={"session_id": "t", "items": [{"id": "5", "quantity": 1}, {"id": "5", "quantity": 2}]})
        self.assertEqual(calls[-1], [{"productCode": "5", "quantity": 3}])

    def test_不在菜单里的id被拒绝且不改购物车(self):
        c, s, _ = make_app(MENU)
        s.cart.add("5", "可乐", 9.5, 1)
        r = c.post("/api/kitchen/checkout", json={"session_id": "t", "items": [{"id": "999", "quantity": 1}]})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(s.cart.items_for_mcp(), [{"productCode": "5", "quantity": 1}])

    def test_套餐和会员价商品不能结算(self):
        c, s, _ = make_app(MENU)
        for pid in ("77", "88"):
            r = c.post("/api/kitchen/checkout", json={"session_id": "t", "items": [{"id": pid, "quantity": 1}]})
            self.assertEqual(r.status_code, 400, pid)

    def test_数量越界被拒绝(self):
        c, s, _ = make_app(MENU)
        for q in (0, -1, 21, 999):
            r = c.post("/api/kitchen/checkout", json={"session_id": "t", "items": [{"id": "5", "quantity": q}]})
            self.assertEqual(r.status_code, 422, q)

    def test_空订单被拒绝(self):
        c, s, _ = make_app(MENU)
        self.assertEqual(c.post("/api/kitchen/checkout", json={"session_id": "t", "items": []}).status_code, 422)

    def test_不存在的会话返回404(self):
        c, s, _ = make_app(MENU)
        self.assertEqual(c.get("/api/kitchen/menu", params={"session_id": "nope"}).status_code, 404)

    def test_同一会话重复结算以最新订单为准(self):
        c, s, calls = make_app(MENU)
        c.post("/api/kitchen/checkout", json={"session_id": "t", "items": [{"id": "1100", "quantity": 1}]})
        c.post("/api/kitchen/checkout", json={"session_id": "t", "items": [{"id": "5", "quantity": 1}]})
        self.assertEqual(s.cart.items_for_mcp(), [{"productCode": "5", "quantity": 1}])


if __name__ == "__main__":
    unittest.main()
