"""会话存储 与 对话历史截断 的测试。不联网。

运行(项目根目录): python -m unittest tests.test_session_history -v
"""
import random
import unittest

from app.history import is_well_formed, trim_history
from app.session_store import SessionStore


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class SessionStoreTest(unittest.TestCase):
    def setUp(self):
        self.c = Clock()
        self.s = SessionStore(ttl=100, max_sessions=3, clock=self.c)

    def test_存取(self):
        self.s.put("a", 1)
        self.assertEqual(self.s.get("a"), 1)
        self.assertIsNone(self.s.get("nope"))

    def test_超过ttl过期(self):
        self.s.put("a", 1)
        self.c.t = 101
        self.assertIsNone(self.s.get("a"))
        self.assertEqual(len(self.s), 0)

    def test_恰好等于ttl不过期(self):
        self.s.put("a", 1)
        self.c.t = 100
        self.assertEqual(self.s.get("a"), 1)

    def test_访问会续期(self):
        self.s.put("a", 1)
        self.c.t = 90
        self.assertEqual(self.s.get("a"), 1)   # 续期到 t=90
        self.c.t = 180
        self.assertEqual(self.s.get("a"), 1)   # 距上次访问 90 < 100
        self.c.t = 290
        self.assertIsNone(self.s.get("a"))     # 距上次访问 110 > 100

    def test_超过上限淘汰最久未使用的(self):
        for i, k in enumerate("abc"):
            self.c.t = i
            self.s.put(k, i)
        self.c.t = 5
        self.s.get("a")            # a 变成最近使用
        self.s.put("d", 3)         # 超限, 应淘汰 b(最久未使用), 而不是 a
        self.assertIsNone(self.s.get("b"))
        self.assertEqual(self.s.get("a"), 0)
        self.assertEqual(self.s.get("d"), 3)
        self.assertLessEqual(len(self.s), 3)

    def test_过期的不占名额(self):
        self.s.put("a", 1)
        self.s.put("b", 2)
        self.c.t = 200
        self.s.put("c", 3)
        self.s.put("d", 4)
        self.s.put("e", 5)
        self.assertEqual(len(self.s), 3)
        self.assertIsNone(self.s.get("a"))

    def test_in运算符不会误报过期会话(self):
        self.s.put("a", 1)
        self.c.t = 500
        self.assertNotIn("a", self.s)

    def test_默认参数合理(self):
        d = SessionStore()
        self.assertEqual(d.ttl, 7200)
        self.assertEqual(d.max, 500)


def turn(i, tools=0):
    """构造一个回合: user -> [assistant(tool_calls) -> tool*] -> assistant"""
    h = [{"role": "user", "content": f"u{i}"}]
    if tools:
        ids = [f"c{i}_{k}" for k in range(tools)]
        h.append({"role": "assistant", "content": "", "tool_calls": [{"id": x, "type": "function", "function": {"name": "f", "arguments": "{}"}} for x in ids]})
        h += [{"role": "tool", "tool_call_id": x, "content": "{}"} for x in ids]
    h.append({"role": "assistant", "content": f"a{i}"})
    return h


class TrimHistoryTest(unittest.TestCase):
    def build(self, n, tools=2):
        h = []
        for i in range(n):
            h += turn(i, tools)
        return h

    def test_没超限不动(self):
        h = self.build(3)
        before = list(h)
        self.assertEqual(trim_history(h, max_messages=100), 0)
        self.assertEqual(h, before)

    def test_超限时从user边界切且保持合法(self):
        h = self.build(20)             # 每回合 5 条, 共 100
        self.assertTrue(is_well_formed(h))
        trim_history(h, max_messages=40)
        self.assertLessEqual(len(h), 40)
        self.assertEqual(h[0]["role"], "user")
        self.assertTrue(is_well_formed(h))

    def test_保留的是最近的回合(self):
        h = self.build(20)
        trim_history(h, max_messages=40)
        self.assertEqual(h[-1]["content"], "a19")
        self.assertNotIn("u0", [m["content"] for m in h if m["role"] == "user"])

    def test_单个回合就超限时不切坏它(self):
        h = turn(0, tools=30)          # 1+1+30+1 = 33 条
        h += turn(1, tools=30)
        trim_history(h, max_messages=10)
        self.assertTrue(is_well_formed(h))
        self.assertEqual(h[0]["content"], "u1")   # 只保留最后一个完整回合, 即使它仍超限

    def test_只有一个回合时不动(self):
        h = turn(0, tools=50)
        self.assertEqual(trim_history(h, max_messages=5), 0)
        self.assertTrue(is_well_formed(h))

    def test_空历史(self):
        h = []
        self.assertEqual(trim_history(h, 10), 0)

    def test_随机回合长度反复截断始终合法(self):
        rnd = random.Random(7)
        h = []
        for i in range(300):
            h += turn(i, tools=rnd.choice([0, 1, 2, 5]))
            trim_history(h, max_messages=rnd.choice([12, 25, 40]))
            self.assertTrue(is_well_formed(h), f"第 {i} 轮后历史不合法")
            self.assertEqual(h[0]["role"], "user")

    def test_自检函数能识别坏历史(self):
        bad = [{"role": "tool", "tool_call_id": "x", "content": "{}"}]               # 孤立的 tool
        self.assertFalse(is_well_formed(bad))
        bad2 = [{"role": "user", "content": "u"},
                {"role": "assistant", "content": "", "tool_calls": [{"id": "x", "type": "function", "function": {"name": "f", "arguments": "{}"}}]}]
        self.assertFalse(is_well_formed(bad2))                                      # tool_calls 没有结果


if __name__ == "__main__":
    unittest.main()
