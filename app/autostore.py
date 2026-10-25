"""自动选店: 决定"先试哪几家店"。纯函数, 不联网, 可单元测试。

为什么不直接看门店的营业时间/营业状态
- 门店列表里的营业时间是离线快照, 不随节假日、临时歇业变化;
- 接口返回的 businessStatus 并不可靠(实测多数店在能点单时也是 false)。
最可靠的判断是"真的去取菜单": 取得到就是营业中, 取不到就换下一家。
这里只负责排出尝试顺序, 并限制最多试几家, 避免全城打烊时把 55 家都请求一遍。

优先级(从高到低)
  1. 玩家上次手动选的店(如果有, 且还在名单里)
  2. 当前时刻落在营业时间内的店, 同组内可拼汉堡款数多的优先
  3. 其余的店(营业时间可能过期), 排在后面兜底
"""
from __future__ import annotations

import re

MAX_TRIES = 6   # 一次自动选店最多尝试几家


def _minutes(hhmm: str) -> int | None:
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", hhmm or "")
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    return h * 60 + mi if h <= 24 and mi < 60 else None


def is_open_now(hours: str, now_minutes: int) -> bool:
    """hours 形如 '07:00-22:00'、'00:00-23:59'、'22:00-02:00'(跨天)。格式无法识别时返回 False。"""
    if not hours or "-" not in hours:
        return False
    a, b = hours.split("-", 1)
    s, e = _minutes(a), _minutes(b)
    if s is None or e is None:
        return False
    if s == e:
        return False
    if s < e:
        return s <= now_minutes < e or (e >= 23 * 60 + 59 and now_minutes >= s)   # 23:59 视为营业到当天结束
    return now_minutes >= s or now_minutes < e                                      # 跨天营业


def rank_stores(stores: list[dict], now_minutes: int, preferred: str | None = None, limit: int = MAX_TRIES) -> list[dict]:
    """stores 每项至少有 storeCode / hours / burgerCount。返回按尝试顺序排好的前 limit 家。"""
    seen: set[str] = set()
    uniq = []
    for s in stores:
        code = s.get("storeCode")
        if code and code not in seen:
            seen.add(code)
            uniq.append(s)

    def key(s: dict):
        pref = 0 if preferred and s["storeCode"] == preferred else 1
        opened = 0 if is_open_now(s.get("hours", ""), now_minutes) else 1
        return (pref, opened, -(s.get("burgerCount") or 0), s["storeCode"])

    return sorted(uniq, key=key)[: max(1, limit)]
