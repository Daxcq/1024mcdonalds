"""对话历史截断。

OpenAI 兼容协议的硬约束
  1. 每条 role=tool 的消息, 前面必须有包含对应 tool_call_id 的 assistant.tool_calls;
  2. assistant.tool_calls 里的每个 id, 后面都必须有一条对应的 tool 消息。
  从中间随便切一刀会破坏这两条, 下一次请求直接 400。

所以切点只能落在"用户消息"的边界上: 从某条 role=user 开始, 往后的整段(含其中所有工具调用)原样保留。
"""
from __future__ import annotations


def trim_history(history: list[dict], max_messages: int = 40) -> int:
    """原地截断, 返回被丢弃的消息条数。

    规则
    - 总条数不超过 max_messages 就不动。
    - 否则丢掉最老的若干"完整回合"(以 user 消息开头), 直到不超限。
    - 无论如何至少保留最后一个回合; 即使这一个回合就超限也不切(切了会破坏配对)。
    """
    if len(history) <= max_messages:
        return 0
    starts = [i for i, m in enumerate(history) if m.get("role") == "user"]
    if len(starts) <= 1:
        return 0
    cut = 0
    for s in starts[1:]:
        if len(history) - s <= max_messages:
            cut = s
            break
    else:
        cut = starts[-1]          # 保留最后一个回合
    del history[:cut]
    return cut


def is_well_formed(history: list[dict]) -> bool:
    """校验 tool 消息与 tool_calls 成对, 用于测试和运行时自检。"""
    pending: set[str] = set()
    for m in history:
        role = m.get("role")
        if role == "assistant":
            if pending:
                return False
            pending = {tc["id"] for tc in (m.get("tool_calls") or [])}
        elif role == "tool":
            if m.get("tool_call_id") not in pending:
                return False
            pending.discard(m["tool_call_id"])
        elif role == "user":
            if pending:
                return False
    return not pending
