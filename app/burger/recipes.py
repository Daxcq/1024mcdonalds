"""汉堡配方表: 接口给配料, 人工表给主料和规格, 合成每个汉堡的食材集合。

数据来源是整个城市的门店快照。同一个汉堡 code 在各店的配料基本一致, 取多数派;
每个汉堡记录它在哪些门店有售, 引擎按玩家所选门店过滤。

纯数据加工, 不联网。
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent.parent / "data"

PATTY = "主料"      # 牛肉/鸡肉/鱼肉: 决定汉堡"是什么"
SPEC = "规格"       # 双层牛肉/鸡腿排...: 区分配料相同的汉堡, 是玩家要选的第二步
TOPPING = "配料"    # 酱/菜/芝士: 接口给出的可增减项


@dataclass(frozen=True)
class Ingredient:
    name: str
    kind: str  # PATTY | SPEC | TOPPING


@dataclass
class Recipe:
    code: str
    name: str
    patty: str
    spec: str
    toppings: frozenset[str]
    prices: dict[str, float] = field(default_factory=dict)  # storeCode -> 价格
    verified: bool = False  # 主料/规格是否已被人工核对
    image: str = ""

    @property
    def parts(self) -> frozenset[Ingredient]:
        return frozenset(
            [Ingredient(self.patty, PATTY), Ingredient(self.spec, SPEC)]
            + [Ingredient(t, TOPPING) for t in self.toppings]
        )

    @property
    def stores(self) -> frozenset[str]:
        return frozenset(self.prices)

    def price_at(self, store: str | None) -> float | None:
        if store is None:
            return None
        return self.prices.get(store)


def _toppings(detail: dict, syn: dict[str, str]) -> tuple[str, ...]:
    mods = list((detail.get("modification") or {}).get("items", []))
    # 部分汉堡(如双层鳕鱼堡)的配料挂在 rounds 的默认选项里
    for rd in detail.get("rounds", []):
        for c in rd.get("choices", []):
            if c.get("isDefault") == 1:
                mods += (c.get("modification") or {}).get("items", [])
    out = set()
    for g in mods:
        for v in g.get("values", []):
            if v.get("selectedQuantity", 0) >= 1:  # 默认带上的才算这个汉堡的配料
                out.add(syn.get(v["name"], v["name"]))
    return tuple(sorted(out))


def build_recipes(city: list[dict], overrides: dict) -> list[Recipe]:
    """city 来自 scripts.fetch_city_burgers; overrides 来自 data/burger_overrides.json。"""
    syn = overrides.get("同义配料", {})
    over = overrides.get("items", {})

    tops: dict[str, Counter] = defaultdict(Counter)
    names: dict[str, str] = {}
    images: dict[str, str] = {}
    prices: dict[str, dict[str, float]] = defaultdict(dict)
    for store in city:
        for it in store.get("items", []):
            code = it["code"]
            o = over.get(code)
            if not o or "排除" in o:
                continue
            tops[code][_toppings(it["detail"], syn)] += 1
            names[code] = it["name"]
            images.setdefault(code, it.get("image", ""))
            prices[code][store["store"]] = it["price"]

    out: list[Recipe] = []
    for code, counter in tops.items():
        o = over[code]
        out.append(
            Recipe(
                code=code,
                name=names[code],
                patty=o["主料"][0],
                spec=o["规格"],
                toppings=frozenset(counter.most_common(1)[0][0]),  # 各店不一致时取多数派
                prices=dict(prices[code]),
                verified="[待核]" not in o.get("备注", ""),
                image=images[code],
            )
        )
    return out


def load_recipes() -> list[Recipe]:
    city = json.loads((DATA / "city_burgers_changchun.json").read_text(encoding="utf-8"))
    over = json.loads((DATA / "burger_overrides.json").read_text(encoding="utf-8"))
    return build_recipes(city, over)
