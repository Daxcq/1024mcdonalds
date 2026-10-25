"""agent 循环的离线测试: 假模型 + 假 MCP, 不联网。

覆盖 tests/fake_llm_check.py 里需要联网才能验证的关键行为:
  - 模型试图调用不存在/受限的工具 -> 被拦下, 作为错误回给模型
  - 坏 JSON 参数 -> 作为错误回给模型, 不崩
  - 麦当劳接口整体不可用 -> 本轮终止并回滚历史(不让模型反复重试)
  - 长对话 -> 历史被截断, 且仍满足 tool_calls/tool 成对
  - 模型本身出错 -> 历史回滚

运行(项目根目录): python -m unittest tests.test_agent_offline -v
"""
import asyncio
import json
import types
import unittest

from app.agent import MAX_HISTORY, Agent
from app.history import is_well_formed
from app.mcd_client import McdUnavailable
from app.session import Session, Store

NS = types.SimpleNamespace


def call(i, name, args):
    raw = args if isinstance(args, str) else json.dumps(args)
    return NS(id=i, type="function", function=NS(name=name, arguments=raw))


def reply(content=None, calls=None):
    return NS(choices=[NS(message=NS(content=content, tool_calls=calls or None))])


class FakeLLM:
    def __init__(self, script):
        self.script = list(script)
        self.requests = []
        self.chat = NS(completions=self)

    async def create(self, **kw):
        self.requests.append(kw["messages"])
        if not self.script:
            raise RuntimeError("模型挂了")
        nxt = self.script.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


class FakeMcd:
    """记录调用; fail=True 时模拟麦当劳接口不可用。"""

    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    async def call(self, name, args=None, allow_write=False):
        self.calls.append(name)
        if self.fail:
            raise McdUnavailable("网络连不上(测试)")
        return {"success": True, "data": []}


def make_agent(script, mcd=None):
    a = Agent.__new__(Agent)
    a.mcd, a.model, a.effort = mcd or FakeMcd(), "x", None
    a.client = FakeLLM(script)
    return a


def run(coro):
    return asyncio.run(coro)


class AgentOfflineTest(unittest.TestCase):
    def test_模型无法调用下单工具(self):
        a = make_agent([reply(calls=[call("1", "create_order", {}), call("2", "create-order", {})]), reply(content="好的")])
        s = Session(id="t")
        r = run(a.chat(s, "帮我下单"))
        self.assertEqual([(t["tool"], t["ok"]) for t in r["trace"]], [("create_order", False), ("create-order", False)])
        self.assertNotIn("create-order", a.mcd.calls)   # 麦当劳下单接口一次都没被调用
        self.assertTrue(is_well_formed(s.history))

    def test_坏JSON参数作为错误返回而不崩(self):
        a = make_agent([reply(calls=[call("1", "cart_add", "{not json")]), reply(content="抱歉")])
        s = Session(id="t")
        r = run(a.chat(s, "加一个"))
        self.assertEqual(r["trace"][0]["ok"], False)
        self.assertEqual(r["reply"], "抱歉")
        self.assertTrue(is_well_formed(s.history))

    def test_麦当劳不可用时本轮终止并回滚(self):
        s = Session(id="t")
        s.store = Store(store_code="X", name="X")
        a = make_agent([reply(calls=[call("1", "search_stores", {"city": "长春", "keyword": "站"})]),
                        reply(content="不应走到这里")], mcd=FakeMcd(fail=True))
        before = len(s.history)
        with self.assertRaises(McdUnavailable):
            run(a.chat(s, "附近有什么店"))
        self.assertEqual(len(s.history), before)        # 回滚: 没有残留的 user / tool_calls
        self.assertEqual(len(a.client.script), 1)        # 没有再去问模型"怎么办"(不会反复重试)

    def test_模型自身出错时回滚(self):
        a = make_agent([reply(calls=[call("1", "cart_clear", {})]), RuntimeError("500")])
        s = Session(id="t")
        with self.assertRaises(RuntimeError):
            run(a.chat(s, "清空"))
        self.assertEqual(s.history, [])

    def test_长对话被截断且保持合法(self):
        script = []
        for i in range(60):
            script += [reply(calls=[call(f"c{i}", "cart_clear", {})]), reply(content=f"第{i}轮")]
        a = make_agent(script)
        s = Session(id="t")
        for i in range(60):
            run(a.chat(s, f"第{i}句"))
            self.assertTrue(is_well_formed(s.history), f"第 {i} 轮后不合法")
        self.assertLessEqual(len(s.history), MAX_HISTORY + 4)   # 当前回合本身可超过上限几条
        self.assertEqual(s.history[0]["role"], "user")
        # 发给模型的最后一次请求里, 最老的用户消息已经被丢掉
        last = a.client.requests[-1]
        users = [m["content"] for m in last if m["role"] == "user"]
        self.assertNotIn("第0句", users)
        self.assertEqual(users[-1], "第59句")

    def test_超过步数上限时给出兜底回复(self):
        script = [reply(calls=[call(f"c{i}", "cart_clear", {})]) for i in range(20)]
        a = make_agent(script)
        s = Session(id="t")
        r = run(a.chat(s, "一直调"))
        self.assertIn("再说一次", r["reply"])
        self.assertTrue(is_well_formed(s.history))


if __name__ == "__main__":
    unittest.main()
