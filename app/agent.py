"""点单 agent: OpenAI 兼容协议的 tool-calling 循环 (DeepSeek / 通义 / Kimi / 智谱 / 豆包等通用)。"""
import json
import os

from openai import AsyncOpenAI

from .history import trim_history
from .mcd_client import McdClient, McdUnavailable
from .session import Session
from .tools import TOOL_SPECS, run_tool

MAX_STEPS = 8
MAX_HISTORY = 40  # 历史消息条数上限(含工具调用与结果), 超出时丢最老的完整回合

SYSTEM_PROMPT = """你是麦当劳点单台的店员助手"小麦", 帮顾客点餐并做推荐。

原则:
- 说话简短、亲切, 像柜台店员。每次回复不超过 4 句, 推荐时最多给 3 个选项。
- 没选门店前, 先问城市和所在位置(商圈/路名), 用 search_stores 找店, 让顾客确认后 select_store。
- 推荐必须基于 search_menu 查到的真实餐品、真实价格。不要编造菜名、价格、热量。
- 顾客说预算、人数、口味、想控制热量时, 先 search_menu 再组合搭配, 并把总价算给对方。
- 热量只有 get_nutrition 查到的才能说, 查不到就如实说"暂无数据", 不要估算。
- 顾客明确说要哪个才 cart_add; 只是在问或比较时不要擅自加购。
- 点完后调用 calculate_price 报总价, 然后提醒顾客在右侧点"确认下单"。你无法替顾客下单, 也不要说"已为您下单"。
- 带"麦金卡"的餐品是会员价, 非会员实际按原价。默认不推荐; 顾客说自己有麦金卡时才用 include_member_card=true 检索, 并说明是会员价。
- 算价结果与预估价不一致时, 以算价为准, 如实告诉顾客差额, 不要替系统解释原因。
- 价格单位是元。"""

# tools.py 里用的是通用的 name/description/input_schema, 这里转成 OpenAI function 格式
OPENAI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": t["name"],
            "description": t["description"],
            "parameters": t["input_schema"],
        },
    }
    for t in TOOL_SPECS
]


class Agent:
    def __init__(self, mcd: McdClient) -> None:
        self.mcd = mcd
        self.model = os.environ["LLM_MODEL"]
        # 可选: 推理模型(如 StepFun step-3.7-flash)的思考强度 low/medium/high, 点单场景用 low 更快
        self.effort = os.environ.get("LLM_REASONING_EFFORT") or None
        self.client = AsyncOpenAI(
            api_key=os.environ["LLM_API_KEY"],
            base_url=os.environ["LLM_BASE_URL"],
            timeout=60,
        )

    async def chat(self, s: Session, user_text: str) -> dict:
        trim_history(s.history, MAX_HISTORY)  # 长对话只保留最近的完整回合, 防止越聊越慢越贵
        mark = len(s.history)  # 本轮失败时回滚到这里, 避免留下残缺的 tool_calls 对话
        s.history.append({"role": "user", "content": user_text})
        trace: list[dict] = []
        try:
            return await self._loop(s, trace)
        except BaseException:
            del s.history[mark:]
            raise

    async def _loop(self, s: Session, trace: list[dict]) -> dict:
        reply = ""
        for _ in range(MAX_STEPS):
            system = SYSTEM_PROMPT + f"\n\n[当前状态] {json.dumps(s.snapshot(), ensure_ascii=False)}"
            extra = {"reasoning_effort": self.effort} if self.effort else {}
            resp = await self.client.chat.completions.create(
                model=self.model,
                max_tokens=2048,  # 推理模型的思考也计入 token, 留足空间避免正文被截断
                messages=[{"role": "system", "content": system}, *s.history],
                tools=OPENAI_TOOLS,
                **extra,
            )
            msg = resp.choices[0].message
            # 只保留协议要求的字段, 避免把厂商私有字段(如 reasoning_content)回传导致 400
            entry: dict = {"role": "assistant", "content": msg.content or ""}
            if msg.tool_calls:
                entry["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments or "{}"},
                    }
                    for tc in msg.tool_calls
                ]
            s.history.append(entry)

            if not msg.tool_calls:
                reply = msg.content or ""
                break

            for tc in msg.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                    if not isinstance(args, dict):
                        raise ValueError("参数必须是 JSON 对象")
                    out = await run_tool(name, args, s, self.mcd)
                except McdUnavailable:
                    # 麦当劳接口整体不可用不是模型能解决的问题: 终止本轮并回滚, 由接口层统一返回 503 提示,
                    # 否则模型会拿到一句报错然后反复重试同一个调用
                    raise
                except Exception as e:  # 其他工具失败交给模型自己处理, 不要让整轮对话崩掉
                    args = {}
                    out = {"error": f"{type(e).__name__}: {e}"}
                trace.append({"tool": name, "input": args, "ok": "error" not in out})
                s.history.append(
                    {"role": "tool", "tool_call_id": tc.id, "content": json.dumps(out, ensure_ascii=False)}
                )
        else:
            reply = "我这边处理得有点久, 你再说一次想要什么?"

        return {"reply": reply, "trace": trace, "state": s.snapshot()}
