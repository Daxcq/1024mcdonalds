"""真实 LLM + 真实 MCP 的多轮对话冒烟测试。只到算价为止, 不会下单。
运行: python -m tests.live_chat
"""
import asyncio, time
from app.agent import Agent
from app.mcd_client import McdClient, load_env
from app.session import Session

TURNS = [
    "我在上海人民广场附近",
    "选第一家",
    "两个人吃，预算50块，推荐一下",
    "就按你说的来吧",
    "帮我算下价",
]

async def main():
    load_env()
    m = McdClient(); await m.start()
    a = Agent(m); s = Session(id="live")
    for t in TURNS:
        t0 = time.time()
        r = await a.chat(s, t)
        print(f"\n用户: {t}\n小麦({time.time()-t0:.1f}s): {r['reply']}")
        print("  工具:", [(x['tool'], x['ok']) for x in r['trace']])
    print("\n购物车:", s.cart.to_dict())
    print("待确认订单:", bool(s.pending_order))
    await m.stop()

asyncio.run(main())
