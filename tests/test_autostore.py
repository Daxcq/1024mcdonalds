"""自动选店的测试。不联网: 用假的门店列表、假的"选店"函数、固定的时钟。

运行(项目根目录): python -m unittest tests.test_autostore -v
"""
import unittest
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.autostore import MAX_TRIES, is_open_now, rank_stores
from app.kitchen_api import CN, make_router, now_minutes_cn
from app.mcd_client import McdUnavailable
from app.menu import Meal
from app.session import Session, Store


def hm(h, m=0):
    return h * 60 + m


class IsOpenNowTest(unittest.TestCase):
    def test_普通时段(self):
        self.assertTrue(is_open_now("07:00-22:00", hm(12)))
        self.assertTrue(is_open_now("07:00-22:00", hm(7)))          # 开门那一分钟算营业
        self.assertFalse(is_open_now("07:00-22:00", hm(22)))        # 关门那一分钟不算
        self.assertFalse(is_open_now("07:00-22:00", hm(6, 59)))
        self.assertFalse(is_open_now("07:00-22:00", hm(23)))

    def test_全天营业(self):
        for t in (hm(0), hm(3), hm(12), hm(23, 58), hm(23, 59)):
            self.assertTrue(is_open_now("00:00-23:59", t), t)

    def test_跨天营业(self):
        self.assertTrue(is_open_now("22:00-02:00", hm(23)))
        self.assertTrue(is_open_now("22:00-02:00", hm(1)))
        self.assertFalse(is_open_now("22:00-02:00", hm(12)))

    def test_格式不对一律当作不营业(self):
        for bad in ("", None, "全天", "7-22", "25:00-26:00", "07:00", "07:00-07:00"):
            self.assertFalse(is_open_now(bad, hm(12)), repr(bad))


def S(code, hours, n, name=None):
    return {"storeCode": code, "name": name or code, "hours": hours, "burgerCount": n}


STORES = [
    S("closed_many", "07:00-22:00", 14),
    S("open_few", "06:00-23:00", 4),
    S("open_many", "06:00-23:00", 13),
    S("allday", "00:00-23:59", 13),
]


class RankTest(unittest.TestCase):
    def codes(self, **kw):
        return [s["storeCode"] for s in rank_stores(STORES, **kw)]

    def test_营业中的排在打烊的前面_同组按款数(self):
        # 23:30: 只有 allday 在营业
        self.assertEqual(self.codes(now_minutes=hm(23, 30), limit=10)[0], "allday")
        # 12:00: 三家营业, 款数多的在前, 打烊的(不存在)无; closed_many 也在营业
        got = self.codes(now_minutes=hm(12), limit=10)
        self.assertEqual(got[0], "closed_many")      # 14 款, 12 点营业
        self.assertLess(got.index("open_many"), got.index("open_few"))

    def test_上次选的店优先_即使它现在打烊(self):
        self.assertEqual(self.codes(now_minutes=hm(23, 30), preferred="closed_many")[0], "closed_many")

    def test_上次选的店不在名单里就忽略(self):
        self.assertEqual(self.codes(now_minutes=hm(23, 30), preferred="已下线的店")[0], "allday")

    def test_限制尝试数量(self):
        many = [S(f"s{i}", "07:00-22:00", i) for i in range(50)]
        self.assertEqual(len(rank_stores(many, hm(12))), MAX_TRIES)
        self.assertEqual(len(rank_stores(many, hm(12), limit=0)), 1)   # 至少试一家

    def test_重复门店去重_空列表不崩(self):
        self.assertEqual(len(rank_stores([S("a", "07:00-22:00", 1)] * 3, hm(12))), 1)
        self.assertEqual(rank_stores([], hm(12)), [])

    def test_排序是确定的(self):
        a = [S("b", "07:00-22:00", 5), S("a", "07:00-22:00", 5)]
        self.assertEqual([s["storeCode"] for s in rank_stores(a, hm(12))], ["a", "b"])


class ClockTest(unittest.TestCase):
    def test_按北京时间而不是服务器时区(self):
        # 同一瞬间: UTC 16:00 = 北京次日 00:00
        utc = datetime(2026, 10, 24, 16, 0, tzinfo=__import__("datetime").timezone.utc)
        self.assertEqual(now_minutes_cn(lambda: utc.astimezone(CN)), 0)


class FakeWorld:
    """假的 server 侧依赖: 记录尝试过哪些店, 按配置决定哪些店能取到菜单。"""

    def __init__(self, open_codes=(), mcd_down=False):
        self.open, self.mcd_down, self.tried = set(open_codes), mcd_down, []
        self.s = Session(id="t")
        self.s.store = None

    def get_session(self, sid):
        if sid != "t":
            raise HTTPException(404, "会话已过期")
        return self.s

    async def calc(self, s):
        return {"ok": True}

    def stores(self):
        return STORES

    async def pick(self, s, code):
        self.tried.append(code)
        if self.mcd_down:
            raise McdUnavailable("网络连不上(测试)")
        if code not in self.open:
            return {"error": "这家店现在已打烊或不在营业时间"}
        s.store = Store(store_code=code, name=code)
        s.menu = {"1100": Meal(code="1100", name="巨无霸", price=26.0, original_price=26.0)}
        return {"ok": True}


def client(world, now=hm(23, 30)):
    app = FastAPI()
    clock = lambda: datetime(2026, 10, 25, now // 60, now % 60, tzinfo=CN)
    app.include_router(make_router(world.get_session, world.calc, world.stores, world.pick, clock=clock))

    @app.exception_handler(McdUnavailable)
    async def _h(_, e):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content={"detail": str(e)})

    return TestClient(app)


class AutoStoreApiTest(unittest.TestCase):
    def post(self, c, **body):
        return c.post("/api/kitchen/auto-store", json={"session_id": "t", **body})

    def test_第一家可用就只试一家(self):
        w = FakeWorld(open_codes={"allday"})
        r = self.post(client(w))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["store"]["storeCode"], "allday")
        self.assertEqual(w.tried, ["allday"])
        self.assertEqual(r.json()["tried"], [])

    def test_前面的店打烊时依次往后试(self):
        w = FakeWorld(open_codes={"open_few"})          # 只有 open_few 能取到
        r = self.post(client(w), preferred="closed_many")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["store"]["storeCode"], "open_few")
        self.assertEqual(w.tried[0], "closed_many")      # 上次选的店先试, 失败后继续
        self.assertEqual([t["storeCode"] for t in r.json()["tried"]], w.tried[:-1])
        self.assertIn("打烊", r.json()["tried"][0]["reason"])

    def test_全部取不到时返回409且说明原因_不是500(self):
        w = FakeWorld(open_codes=set())
        r = self.post(client(w))
        self.assertEqual(r.status_code, 409)
        self.assertIn("手动选择", r.json()["detail"])
        self.assertEqual(len(w.tried), len(STORES))      # 名单只有 4 家, 全试了

    def test_MCP不可用时立刻停止_不逐家重试(self):
        w = FakeWorld(mcd_down=True)
        r = self.post(client(w))
        self.assertEqual(r.status_code, 503)
        self.assertIn("网络连不上", r.json()["detail"])
        self.assertEqual(len(w.tried), 1)

    def test_返回的菜单是后厨可用的商品(self):
        w = FakeWorld(open_codes={"allday"})
        items = self.post(client(w)).json()["items"]
        self.assertEqual([i["id"] for i in items], ["1100"])
        self.assertEqual(items[0]["price"], 26.0)

    def test_会话不存在返回404(self):
        w = FakeWorld()
        r = client(w).post("/api/kitchen/auto-store", json={"session_id": "nope"})
        self.assertEqual(r.status_code, 404)

    def test_preferred超长被拒绝(self):
        w = FakeWorld(open_codes={"allday"})
        self.assertEqual(self.post(client(w), preferred="x" * 100).status_code, 422)
        self.assertEqual(w.tried, [])


if __name__ == "__main__":
    unittest.main()
