"""会话存储: 带过期时间和数量上限的内存字典。

为什么需要
- 每次打开页面都会新建一个会话; 原来是普通 dict, 永不清理, 服务开久了内存只增不减。
- 会话里有用户的购物车和对话历史, 久不使用的应当丢弃。

行为
- 每次访问会刷新"最后使用时间"。
- 超过 ttl 秒未使用 -> 过期, 访问时返回 None。
- 超过 max_sessions -> 淘汰最久未使用的。
- 不开后台线程: 清理在读写时顺带完成, 没有额外的并发问题。
- 进程重启后全部丢失(内存存储)。
"""
from __future__ import annotations

import time
from collections import OrderedDict
from typing import Callable, Generic, TypeVar

T = TypeVar("T")


class SessionStore(Generic[T]):
    def __init__(self, ttl: float = 2 * 3600, max_sessions: int = 500,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.ttl = ttl
        self.max = max_sessions
        self._clock = clock
        self._d: "OrderedDict[str, tuple[float, T]]" = OrderedDict()

    def __len__(self) -> int:
        self._purge()
        return len(self._d)

    def __contains__(self, sid: str) -> bool:
        return self.get(sid) is not None

    def put(self, sid: str, value: T) -> None:
        self._purge()
        self._d[sid] = (self._clock(), value)
        self._d.move_to_end(sid)
        while len(self._d) > self.max:
            self._d.popitem(last=False)   # 最久未使用的

    def get(self, sid: str) -> T | None:
        item = self._d.get(sid)
        if item is None:
            return None
        if self._clock() - item[0] > self.ttl:
            del self._d[sid]
            return None
        self._d[sid] = (self._clock(), item[1])   # 刷新最后使用时间
        self._d.move_to_end(sid)
        return item[1]

    def _purge(self) -> None:
        now = self._clock()
        # OrderedDict 按"最近使用"排序, 最老的在前, 遇到第一个没过期的即可停止
        while self._d:
            sid, (ts, _) = next(iter(self._d.items()))
            if now - ts > self.ttl:
                del self._d[sid]
            else:
                break
