"""select_store 的行为测试: 选店失败时不能破坏会话里已经选好的店、菜单和购物车。

此前的实现是先把 s.store 设成候选店再取菜单, 失败时再清空 —— 于是"换到一家打烊的店"会把
原来选好的店也丢掉。现在改为"取到菜单才替换"。不联网。

运行(项目根目录): python -m unittest tests.test_select_store -v
"""
import asyncio
import unittest

from app.mcd_client import McdUnavailable
from app.session import Session, Store
from app.tools import run_tool


class FakeMcd:
    """query-meals 按门店返回: closed 的店返回失败消息; down 时抛 McdUnavailable。"""

    def __init__(self, closed=(), down=False, msg="门店可能已关闭或不在营业时间"):
        self.closed, self.down, self.msg, self.calls = set(closed), down, msg, []

    async def call(self, name, args=None, allow_write=False):
        self.calls.append((name, (args or {}).get("storeCode")))
        if self.down:
            raise McdUnavailable("网络连不上(测试)")
        if name == "query-meals":
            if args["storeCode"] in self.closed:
                return {"success": False, "message": self.msg}
            return {"success": True, "data": {"categories": [], "meals": {
                "1100": {"name": "巨无霸", "image": "", "currentPrice": "26", "originalPrice": "26"}}}}
        if name == "list-nutrition-foods":
            return {"success": True, "data": ""}
        return {"success": False}


def run(coro):
    return asyncio.run(coro)


def ready_session():
    s = Session(id="t")
    s.store = Store(store_code="OLD", name="OLD")
    s.menu = {"old": object()}
    s.cart.add("old", "旧商品", 10.0, 1)
    s.pending_order = {"price": 10}
    return s


class SelectStoreTest(unittest.TestCase):
    def test_选店成功会替换店_菜单并清空购物车(self):
        s, m = ready_session(), FakeMcd()
        out = run(run_tool("select_store", {"store_code": "NEW"}, s, m))
        self.assertTrue(out.get("ok"))
        self.assertEqual(s.store.store_code, "NEW")
        self.assertEqual(list(s.menu), ["1100"])
        self.assertEqual(s.cart.items_for_mcp(), [])
        self.assertIsNone(s.pending_order)

    def test_目标店打烊时保持原店_原菜单_原购物车(self):
        s, m = ready_session(), FakeMcd(closed={"NEW"})
        out = run(run_tool("select_store", {"store_code": "NEW"}, s, m))
        self.assertIn("error", out)
        self.assertEqual(s.store.store_code, "OLD")
        self.assertEqual(list(s.menu), ["old"])
        self.assertEqual(s.cart.items_for_mcp(), [{"productCode": "old", "quantity": 1}])
        self.assertEqual(s.pending_order, {"price": 10})

    def test_打烊提示是给用户看的话(self):
        out = run(run_tool("select_store", {"store_code": "NEW"}, Session(id="t"), FakeMcd(closed={"NEW"})))
        self.assertIn("打烊", out["error"])
        self.assertNotIn("可能已关闭", out["error"])

    def test_其他失败原因原样透传(self):
        out = run(run_tool("select_store", {"store_code": "NEW"}, Session(id="t"), FakeMcd(closed={"NEW"}, msg="餐厅不支持预约")))
        self.assertEqual(out["error"], "餐厅不支持预约")

    def test_首次选店失败后会话仍然没有店(self):
        s = Session(id="t")
        run(run_tool("select_store", {"store_code": "NEW"}, s, FakeMcd(closed={"NEW"})))
        self.assertIsNone(s.store)

    def test_MCP不可用时向上抛_并且保持原状(self):
        s = ready_session()
        with self.assertRaises(McdUnavailable):
            run(run_tool("select_store", {"store_code": "NEW"}, s, FakeMcd(down=True)))
        self.assertEqual(s.store.store_code, "OLD")
        self.assertEqual(list(s.menu), ["old"])


if __name__ == "__main__":
    unittest.main()
