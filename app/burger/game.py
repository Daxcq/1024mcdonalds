"""汉堡游戏层: 把引擎状态转成前端可用的 JSON, 并处理"拼好后加购"。

玩家每次点食材只走这里的纯函数, 不联网、不调模型, 保证即时响应。
"""
from __future__ import annotations

from .engine import BurgerEngine, State
from .recipes import PATTY, SPEC, TOPPING, Ingredient, Recipe

KINDS = (PATTY, SPEC, TOPPING)


def parse_selection(raw: list[dict]) -> frozenset[Ingredient]:
    """前端传 [{name, kind}], 非法种类直接丢弃, 不信任客户端输入。"""
    out = set()
    for x in raw:
        name, kind = str(x.get("name", ""))[:20], x.get("kind")
        if name and kind in KINDS:
            out.add(Ingredient(name, kind))
    return frozenset(out)


def _recipe_json(r: Recipe, store: str | None) -> dict:
    return {
        "code": r.code,
        "name": r.name,
        "patty": r.patty,
        "spec": r.spec,
        "toppings": sorted(r.toppings),
        "price": r.price_at(store),
        "image": r.image,
        "verified": r.verified,
    }


def state_json(eng: BurgerEngine, selected: frozenset[Ingredient], store: str | None) -> dict:
    st: State = eng.evaluate(selected, store)
    return {
        "step": st.step,
        "selected": [{"name": i.name, "kind": i.kind} for i in sorted(st.selected, key=lambda i: (KINDS.index(i.kind), i.name))],
        "options": [
            {
                "name": o.ingredient.name,
                "kind": o.ingredient.kind,
                "selectable": o.selectable,
                "selected": o.selected,
                "reason": o.reason,
                "leadsTo": list(o.leads_to),
            }
            for o in st.options
        ],
        "exact": [_recipe_json(r, store) for r in st.exact],
        "reachableCount": len(st.reachable),
        "hints": [
            {"add": {"name": h.add.name, "kind": h.add.kind}, "burger": h.burger.name} for h in st.hints
        ],
        "nearest": [
            {"burger": _recipe_json(r, store), "missing": list(m), "extra": list(e)} for r, m, e in st.nearest
        ],
        # 配方里的规格/主料是人工推断, 未核对时前端要标注, 不能当作官方信息
        "unverified": any(not r.verified for r in st.exact),
    }


def pick_exact(eng: BurgerEngine, selected: frozenset[Ingredient], store: str | None, code: str) -> Recipe | None:
    """加购前校验: 玩家拼出的组合必须确实等于该 code 的汉堡, 且该店有售。"""
    st = eng.evaluate(selected, store)
    return next((r for r in st.exact if r.code == code), None)
