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

# 汉堡各层营养参考值(单位: kcal / g), 覆盖面包底/顶、全部主料、规格与配料。
# 采用分层累加模型: 面包底 + 主料基底 + 规格增量 + 各配料 + 面包顶 = 完整汉堡总热量。
INGREDIENT_NUTRITION: dict[str, dict[str, float | int]] = {
    # 面包基底与封顶
    "面包底": {"kcal": 75, "protein": 2.5, "fat": 1.0, "carb": 14.0},
    "面包顶": {"kcal": 85, "protein": 2.8, "fat": 1.5, "carb": 15.5},
    # 主料(基础单层肉排)
    "牛肉": {"kcal": 110, "protein": 9.0, "fat": 8.0, "carb": 0.5},
    "鸡肉": {"kcal": 115, "protein": 9.5, "fat": 6.5, "carb": 4.5},
    "鱼肉": {"kcal": 110, "protein": 8.0, "fat": 5.5, "carb": 7.0},
    # 规格(在主料基础上的分量/工艺增量)
    "双层牛肉": {"kcal": 110, "protein": 9.0, "fat": 8.0, "carb": 0.5},
    "厚牛排": {"kcal": 95, "protein": 8.5, "fat": 7.0, "carb": 0.5},
    "鸡肉饼": {"kcal": 35, "protein": 2.5, "fat": 2.0, "carb": 2.0},
    "鸡腿排": {"kcal": 65, "protein": 5.5, "fat": 4.0, "carb": 2.0},
    "芝士棒鸡腿排": {"kcal": 130, "protein": 8.5, "fat": 8.5, "carb": 5.5},
    "单片鱼排": {"kcal": 25, "protein": 1.5, "fat": 1.5, "carb": 1.5},
    "双层鱼排": {"kcal": 135, "protein": 9.5, "fat": 7.0, "carb": 8.5},
    # 配料(芝士/肉类/蔬菜/酱汁)
    "吉士": {"kcal": 50, "protein": 3.0, "fat": 4.0, "carb": 0.5},
    "高达干酪片": {"kcal": 55, "protein": 3.5, "fat": 4.5, "carb": 0.5},
    "培根": {"kcal": 45, "protein": 3.2, "fat": 3.5, "carb": 0.2},
    "生菜": {"kcal": 5, "protein": 0.3, "fat": 0.0, "carb": 1.0},
    "番茄片": {"kcal": 6, "protein": 0.3, "fat": 0.0, "carb": 1.3},
    "酸黄瓜": {"kcal": 4, "protein": 0.1, "fat": 0.0, "carb": 0.8},
    "洋葱粒": {"kcal": 6, "protein": 0.2, "fat": 0.0, "carb": 1.4},
    "巨无霸酱": {"kcal": 110, "protein": 1.5, "fat": 9.5, "carb": 5.0},
    "麦香鸡酱": {"kcal": 80, "protein": 0.2, "fat": 8.5, "carb": 1.0},
    "麦香鱼酱": {"kcal": 75, "protein": 0.2, "fat": 8.0, "carb": 1.2},
    "番茄酱": {"kcal": 20, "protein": 0.2, "fat": 0.0, "carb": 4.8},
    "芥末酱": {"kcal": 10, "protein": 0.2, "fat": 0.4, "carb": 1.2},
    "芥末沙拉酱": {"kcal": 65, "protein": 0.3, "fat": 6.8, "carb": 1.2},
    "烤味酱": {"kcal": 35, "protein": 0.3, "fat": 1.5, "carb": 5.0},
    "烤牛肉风味酱": {"kcal": 40, "protein": 0.4, "fat": 2.5, "carb": 4.0},
    "辣椒黄油风味酱": {"kcal": 70, "protein": 0.2, "fat": 7.2, "carb": 1.2},
    "醇香芝士风味酱": {"kcal": 55, "protein": 1.2, "fat": 5.0, "carb": 1.5},
    "黄油": {"kcal": 35, "protein": 0.1, "fat": 3.8, "carb": 0.0},
}

DEFAULT_INGREDIENT_NUTRITION: dict[str, float | int] = {
    "kcal": 25,
    "protein": 0.5,
    "fat": 1.5,
    "carb": 2.0,
}


def ingredient_nutrition(name: str) -> dict[str, float | int]:
    """返回单个食材的营养数据(kcal / protein / fat / carb)。"""
    raw = INGREDIENT_NUTRITION.get(name, DEFAULT_INGREDIENT_NUTRITION)
    return {
        "kcal": int(raw["kcal"]),
        "protein": round(float(raw["protein"]), 1),
        "fat": round(float(raw["fat"]), 1),
        "carb": round(float(raw["carb"]), 1),
    }


def calorie_level(kcal: int, complete: bool = True) -> dict[str, str]:
    """根据当前累计卡路里返回热量等级标签与营养建议。"""
    if not complete and kcal < 180:
        return {"level": "light", "label": "轻盈基底", "tip": "挑选主料与配料，实时查看热量与营养变化"}
    if kcal < 400:
        return {"level": "light", "label": "轻盈低负担", "tip": "清爽不腻，控卡期的友好之选"}
    if kcal < 500:
        return {"level": "balanced", "label": "均衡能量", "tip": "优质蛋白与碳水均衡搭配，活力满满"}
    if kcal < 545:
        return {"level": "hearty", "label": "扎实满足", "tip": "肉感十足，饱腹感强，适合正餐充能"}
    return {"level": "indulgent", "label": "热量炸弹", "tip": "双倍快乐大满足，建议搭配无糖茶饮或美式"}


def stack_nutrition(selected: set[Ingredient] | frozenset[Ingredient], include_top_bun: bool = False) -> dict:
    """计算当前砧板上的累计营养值(含面包底 + 已选食材 + 完成时的面包顶)。"""
    base = ingredient_nutrition("面包底")
    top = ingredient_nutrition("面包顶") if include_top_bun else {"kcal": 0, "protein": 0.0, "fat": 0.0, "carb": 0.0}
    kcal = int(base["kcal"]) + int(top["kcal"])
    protein = float(base["protein"]) + float(top["protein"])
    fat = float(base["fat"]) + float(top["fat"])
    carb = float(base["carb"]) + float(top["carb"])
    for ing in selected:
        n = ingredient_nutrition(ing.name)
        kcal += int(n["kcal"])
        protein += float(n["protein"])
        fat += float(n["fat"])
        carb += float(n["carb"])
    lvl = calorie_level(kcal, complete=include_top_bun)
    return {
        "kcal": kcal,
        "protein": round(protein, 1),
        "fat": round(fat, 1),
        "carb": round(carb, 1),
        "baseBunKcal": int(base["kcal"]),
        "topBunKcal": int(top["kcal"]),
        "hasTopBun": include_top_bun,
        "level": lvl["level"],
        "label": lvl["label"],
        "tip": lvl["tip"],
    }


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
    def nutrition(self) -> dict:
        return stack_nutrition(self.parts, include_top_bun=True)

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
