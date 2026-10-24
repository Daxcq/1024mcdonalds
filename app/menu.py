"""菜单、营养数据的整理与查询。"""
import re
from dataclasses import dataclass, field

# 面板左侧分类 -> 关键词(按 MCP 返回的分类名匹配)
PANEL_GROUPS = [
    ("汉堡", ["汉堡", "巨无霸", "安格斯", "堡"]),
    ("炸鸡小食", ["炸鸡", "蘸酱", "小食"]),
    ("饮料", ["饮品", "麦咖啡"]),
    ("甜品", ["甜品"]),
    ("套餐", ["套餐", "单人餐", "多人餐", "随心配", "500大卡", "开心乐园", "人气热卖"]),
]


@dataclass
class Meal:
    code: str
    name: str
    price: float  # 元
    original_price: float
    image: str = ""
    tags: list[str] = field(default_factory=list)
    categories: list[str] = field(default_factory=list)
    kcal: int | None = None

    @property
    def member_only(self) -> bool:
        """带"麦金卡"标签的餐品, 菜单价是会员价; 非会员账号实际算价是原价。"""
        return "麦金卡" in self.tags

    @property
    def cart_price(self) -> float:
        """购物车预估价: 会员专享品按原价估, 避免低估。最终以 calculate-price 为准。"""
        return self.original_price if self.member_only else self.price

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "name": self.name,
            "price": self.price,
            "originalPrice": self.original_price,
            "image": self.image,
            "tags": self.tags,
            "categories": self.categories,
            "kcal": self.kcal,
            "memberOnly": self.member_only,
        }


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def parse_menu(payload: dict) -> list[Meal]:
    """categories 只有 code, meals 字典里才有名称和价格, 这里关联起来。"""
    data = payload.get("data") or {}
    meals_map: dict = data.get("meals") or {}
    meals: dict[str, Meal] = {}
    for code, m in meals_map.items():
        meals[code] = Meal(
            code=code,
            name=m.get("name", ""),
            price=_num(m.get("currentPrice")),
            original_price=_num(m.get("originalPrice")),
            image=m.get("image", ""),
        )
    for cat in data.get("categories") or []:
        cat_name = (cat.get("name") or "").replace("\n", "")
        for item in cat.get("meals") or []:
            m = meals.get(item.get("code"))
            if not m:
                continue
            if cat_name and cat_name not in m.categories:
                m.categories.append(cat_name)
            for t in item.get("tags") or []:
                if t not in m.tags:
                    m.tags.append(t)
    return list(meals.values())


def panel_group(meal: Meal) -> str:
    """把一个餐品归到面板的 5 个大类里; 优先按名称判断, 再看分类。"""
    n = meal.name
    if any(k in n for k in ("麦旋风", "新地", "冰淇淋", "派", "圣代")):
        return "甜品"
    if any(k in n for k in ("可乐", "雪碧", "芬达", "橙汁", "咖啡", "拿铁", "茶", "奶昔", "豆浆", "美式", "饮")):
        return "饮料"
    if any(k in n for k in ("套餐", "三件套", "两件套", "全家桶", "分享", "乐园", "拼盘")):
        return "套餐"
    if any(k in n for k in ("堡", "卷", "麦满分", "巨无霸")):
        return "汉堡"
    if any(k in n for k in ("薯", "鸡翅", "麦乐鸡", "鸡块", "鸡", "玉米")):
        return "炸鸡小食"
    for group, keys in PANEL_GROUPS:
        if any(any(k in c for k in keys) for c in meal.categories):
            return group
    return "套餐"


def parse_nutrition(payload: dict) -> dict[str, dict]:
    """data 是紧凑表格文本: [160]{col,...}:\n  v,v,v ..."""
    raw = payload.get("data")
    if not isinstance(raw, str):
        return {}
    lines = raw.splitlines()
    if not lines:
        return {}
    head = re.search(r"\{(.+?)\}", lines[0])
    if not head:
        return {}
    cols = [c.strip() for c in head.group(1).split(",")]
    out: dict[str, dict] = {}
    for line in lines[1:]:
        parts = [p.strip() for p in line.strip().split(",")]
        if len(parts) < len(cols):
            continue
        row = dict(zip(cols, parts))

        def f(k):
            try:
                return float(row.get(k, ""))
            except ValueError:
                return None

        out[row["productName"]] = {
            "kcal": f("energyKcal"),
            "protein": f("protein"),
            "fat": f("fat"),
            "carb": f("carbohydrate"),
            "sodium": f("sodium"),
        }
    return out


def attach_kcal(meals: list[Meal], nutrition: dict[str, dict]) -> None:
    """营养表按单品命名, 菜单里有些是套餐; 只对名称能精确匹配的餐品填热量。"""
    for m in meals:
        n = nutrition.get(m.name)
        if n and n.get("kcal") is not None:
            m.kcal = int(n["kcal"])


def search(meals: list[Meal], keyword: str = "", max_price: float | None = None,
           group: str | None = None, limit: int = 12, include_member: bool = False) -> list[Meal]:
    kw = keyword.strip()
    res = []
    for m in meals:
        if m.member_only and not include_member:
            continue
        if kw and kw not in m.name and not any(kw in t for t in m.tags) and not any(kw in c for c in m.categories):
            continue
        if max_price is not None and m.price > max_price:
            continue
        if group and panel_group(m) != group:
            continue
        res.append(m)
    return res[:limit]
