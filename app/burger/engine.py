"""拼汉堡匹配引擎: 纯函数, 不联网, 不依赖模型。

玩法分三步: 选主料 -> 选规格 -> 选配料。
规则
- 玩家已选食材集合 S, 当前门店 store (可为 None, 表示还没选店, 此时看全城菜单)。
- 食材 x 可选  <=>  存在该门店有售的汉堡 B 使得 S ∪ {x} ⊆ B。
- 汉堡 B 恰好完成  <=>  S == B 的食材集合。
- 每个不可选的食材都带原因, 前端置灰时展示。
- 规格的作用是区分"配料相同、实物不同"的汉堡, 所以 (主料, 规格, 配料) 三者合一才唯一。
"""
from __future__ import annotations

from dataclasses import dataclass

from .recipes import PATTY, SPEC, TOPPING, Ingredient, Recipe

KIND_ORDER = {PATTY: 0, SPEC: 1, TOPPING: 2}


@dataclass(frozen=True)
class Option:
    ingredient: Ingredient
    selectable: bool
    selected: bool
    reason: str = ""  # 不可选时的原因
    leads_to: tuple[str, ...] = ()  # 选了它之后还能拼出的汉堡名


@dataclass(frozen=True)
class Hint:
    """再加一样就刚好是某个汉堡。"""
    add: Ingredient
    burger: Recipe


@dataclass(frozen=True)
class State:
    selected: frozenset[Ingredient]
    options: tuple[Option, ...]
    exact: tuple[Recipe, ...]  # 与已选完全一致
    reachable: tuple[Recipe, ...]  # 仍有可能拼出的
    hints: tuple[Hint, ...]
    nearest: tuple[tuple[Recipe, tuple[str, ...], tuple[str, ...]], ...]  # (汉堡, 缺少, 多余)
    step: str  # 当前该选哪一步: 主料 / 规格 / 配料 / 完成


class BurgerEngine:
    def __init__(self, recipes: list[Recipe]) -> None:
        self.all_recipes = recipes

    # --- 门店过滤 ---

    def recipes_at(self, store: str | None) -> list[Recipe]:
        if store is None:
            return self.all_recipes
        return [r for r in self.all_recipes if store in r.stores]

    def universe(self, store: str | None) -> tuple[Ingredient, ...]:
        rs = self.recipes_at(store)
        return tuple(sorted({i for r in rs for i in r.parts}, key=lambda i: (KIND_ORDER[i.kind], i.name)))

    # --- 核心 ---

    def evaluate(self, selected, store: str | None = None) -> State:
        sel = frozenset(selected)
        rs = self.recipes_at(store)
        reachable = tuple(r for r in rs if sel <= r.parts)
        exact = tuple(r for r in reachable if r.parts == sel)

        options: list[Option] = []
        for ing in self.universe(store):
            if ing in sel:
                options.append(Option(ing, True, True))
                continue
            leads = tuple(r.name for r in reachable if ing in r.parts)
            if leads:
                options.append(Option(ing, True, False, leads_to=leads))
            else:
                options.append(Option(ing, False, False, reason=self._why_not(sel, ing, rs)))

        hints = tuple(Hint(next(iter(r.parts - sel)), r) for r in reachable if len(r.parts - sel) == 1)
        return State(sel, tuple(options), exact, reachable, hints, self._nearest(sel, rs), self._step(sel, exact))

    @staticmethod
    def _step(sel: frozenset[Ingredient], exact: tuple[Recipe, ...]) -> str:
        kinds = {i.kind for i in sel}
        if PATTY not in kinds:
            return "主料"
        if SPEC not in kinds:
            return "规格"
        return "完成" if exact else "配料"

    # --- 原因与最近邻 ---

    @staticmethod
    def _why_not(sel: frozenset[Ingredient], ing: Ingredient, rs: list[Recipe]) -> str:
        has_ing = [r for r in rs if ing in r.parts]
        if not has_ing:
            return "这家店没有用到它的汉堡"
        if not sel:
            return "这家店没有用到它的汉堡"
        # 冲突者: 对每个用到 ing 的汉堡, 已选里它不具备的食材
        blockers: set[str] = set()
        for r in has_ing:
            blockers.update(i.name for i in sel - r.parts)
        if len(blockers) == 1:
            return f"和「{next(iter(blockers))}」没有一起出现在同一款汉堡里"
        return "已选的组合里没有汉堡用到它"

    @staticmethod
    def _nearest(sel: frozenset[Ingredient], rs: list[Recipe], k: int = 3):
        if not sel:
            return ()
        scored = []
        for r in rs:
            missing = tuple(sorted(i.name for i in r.parts - sel))
            extra = tuple(sorted(i.name for i in sel - r.parts))
            scored.append((len(missing) + len(extra), r, missing, extra))
        scored.sort(key=lambda t: (t[0], t[1].name))
        return tuple((r, m, e) for _, r, m, e in scored[:k])
