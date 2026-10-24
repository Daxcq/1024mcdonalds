"""不依赖真实 LLM: 用脚本化的假模型(OpenAI 响应格式)驱动 agent 循环。

运行: python -m tests.fake_llm_check   (需要能连上麦当劳 MCP)
"""
import asyncio
import json
import types

from app.agent import Agent
from app.mcd_client import McdClient
from app.session import Session

NS = types.SimpleNamespace


def call(i, name, args):
    raw = args if isinstance(args, str) else json.dumps(args)
    return NS(id=i, type="function", function=NS(name=name, arguments=raw))


def reply(content=None, calls=None):
    return NS(choices=[NS(message=NS(content=content, tool_calls=calls or None))])


class FakeCompletions:
    def __init__(self, script):
        self.script = list(script)
        self.seen = []

    async def create(self, **kw):
        self.seen.append(kw["messages"])
        if not self.script:
            raise RuntimeError("boom")
        return self.script.pop(0)


def fake_client(script):
    comp = FakeCompletions(script)
    return NS(chat=NS(completions=comp)), comp


async def main():
    m = McdClient()
    await m.start()
    a = Agent.__new__(Agent)
    a.mcd, a.model, a.effort = m, "x", None

    # 1) 多步调用; 模型还会"试图"调用 create_order、给出坏参数
    a.client, comp = fake_client([
        reply(calls=[call("1", "select_store", {"store_code": "1450713"})]),
        reply(calls=[call("2", "search_menu", {"group": "汉堡", "max_price": 20, "limit": 2})]),
        reply(calls=[call("3", "cart_add", {"code": "521952", "quantity": 1}),
                     call("4", "create_order", {}),
                     call("5", "cart_add", "{not json")]),
        reply(calls=[call("6", "calculate_price", {})]),
        reply(content="龙焰鸡腿堡 15.9 元, 请在右侧点确认下单"),
    ])
    s = Session(id="t")
    r = await a.chat(s, "来个便宜的汉堡")
    flags = [(t["tool"], t["ok"]) for t in r["trace"]]
    print("reply:", r["reply"])
    print("trace:", flags)
    assert r["state"]["pending"] and r["state"]["cart"]["total"] == 15.9
    assert ("create_order", False) in flags, "agent 不应能下单"
    assert ("cart_add", False) in flags, "坏 JSON 参数应作为错误返回给模型"
    # 每个 tool_call 都必须有对应的 tool 消息, 否则真实 API 会 400
    ids = {tc["id"] for m_ in s.history if m_.get("tool_calls") for tc in m_["tool_calls"]}
    answered = {m_["tool_call_id"] for m_ in s.history if m_["role"] == "tool"}
    assert ids == answered, (ids, answered)
    assert comp.seen[0][0]["role"] == "system"
    print("tool_call/tool 配对 OK")

    # 2) 中途模型异常: 历史必须回滚
    n = len(s.history)
    a.client, _ = fake_client([reply(calls=[call("9", "cart_clear", {})])])
    try:
        await a.chat(s, "清空")
    except RuntimeError:
        pass
    assert len(s.history) == n, (len(s.history), n)
    print("history rollback OK")
    await m.stop()


asyncio.run(main())
