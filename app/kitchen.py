"""真实菜单 -> 后厨动画商品定义 的映射层。

远端前端(js/menu.js)的商品是"动画定义": kind 决定制作流程, 其余字段是流程参数。
后端这边是长春门店的真实餐品(名称/价格/code)。这个模块负责把前者翻译成后者:

  - 能被动画表达的 -> 输出 kind + 参数 + 对应素材 key
  - 表达不了的     -> 不输出, 并在报告里说明原因(不编造, 不硬凑)

纯函数, 不联网, 可单元测试。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .menu import Meal

# ---- 前端已有的动画词表(来自远端 js/data.js 的 MD.ING、js/menu.js)----
# 这里只列"后端会引用的值", 前端新增词表时在此同步, 测试会校验素材文件存在。
KITCHEN_ING = {
    "beef", "chicken", "cheese", "lettuce", "tomato", "pickle", "onion", "ketchup", "mayo", "mid",
}
DRINK_COLORS = {  # 饮料颜色, 前端 drink 流程用
    "cola": "#4a2016", "orange": "#ffae17", "iced_coffee": "#a9784b", "hot_coffee": "#2b1608",
}

# 真实汉堡 -> 动画配料序列(下层面包与上层面包之间, 从下到上)。
# 配料来源是接口返回的真实可增减配料 + 汉堡名称里的主料, 不是凭印象。
# 只收录"主料在动画词表里有对应、且其余配料大多能表达"的汉堡; 其余汉堡走降级。
BURGER_ING: dict[str, list[str]] = {
    "1100":   ["beef", "cheese", "lettuce", "pickle", "onion"],            # 巨无霸(接口: 吉士/生菜/酸黄瓜/洋葱粒/巨无霸酱)
    "1120":   ["beef", "cheese", "pickle", "onion", "ketchup"],            # 双层吉士汉堡
    "1106":   ["beef", "lettuce", "tomato", "ketchup"],                    # 培根蔬萃双层牛堡(培根无素材, 略)
    "4648":   ["beef"],                                                    # 不素之霸(接口仅芥末沙拉酱)
    "521316": ["beef", "pickle", "onion", "ketchup"],                      # 高达吉士双牛堡
    "511781": ["beef", "cheese", "lettuce"],                               # 培根安格斯厚牛堡
    "511782": ["beef", "cheese", "tomato"],                                # 芝士安格斯厚牛堡
    "1450":   ["chicken", "lettuce", "mayo"],                              # 麦香鸡
    "1440":   ["chicken", "lettuce", "mayo"],                              # 麦辣鸡腿汉堡
    "1406":   ["chicken", "lettuce"],                                      # 板烧鸡腿堡
    "521952": ["chicken", "lettuce", "ketchup"],                           # 龙焰鸡腿堡
    "521953": ["chicken", "lettuce", "cheese", "ketchup"],                 # 龙焰芝士棒鸡腿堡
    "1600":   ["chicken", "cheese", "mayo"],                               # 麦香鱼(无鱼排素材, 以鸡排代替 -> 标记 approx)
    "9900003586": ["chicken", "cheese", "mayo"],                           # 双层深海鳕鱼堡(同上)
}
# 用了替代素材的汉堡: 动画里的肉排与实物不同, 前端可据此给出提示
APPROX = {"1600": "鱼排用鸡排素材代替", "9900003586": "鱼排用鸡排素材代替"}

# 常见餐品参考热量(kcal), 当接口未返回 m.kcal 时作为兜底参考值
DEFAULT_KCAL_BY_CODE: dict[str, int] = {
    "1100": 555, "1120": 470, "1106": 455, "4648": 505, "521316": 510,
    "511781": 540, "511782": 530, "1450": 395, "1440": 425, "1406": 380,
    "521952": 430, "521953": 535, "1600": 420, "9900003586": 530,
}
DEFAULT_KCAL_BY_KW: tuple[tuple[str, int], ...] = (
    ("脆脆薯条", 330), ("薯条", 310), ("脆薯饼", 150), ("麦乐鸡", 220),
    ("麦辣鸡翅", 240), ("V翅", 230), ("麦麦脆汁鸡", 280), ("派", 250),
    ("可乐", 140), ("雪碧", 145), ("纯悦", 0), ("橙", 120), ("红茶", 90),
    ("美式", 15), ("鲜萃咖啡", 15), ("奶铁", 160),
    ("圆筒冰淇淋", 145), ("新地", 260), ("麦旋风", 340),
)


def _estimate_kcal(m: Meal) -> int:
    if m.kcal is not None and m.kcal > 0:
        return int(m.kcal)
    if m.code in DEFAULT_KCAL_BY_CODE:
        return DEFAULT_KCAL_BY_CODE[m.code]
    for kw, kcal in DEFAULT_KCAL_BY_KW:
        if kw in m.name:
            return kcal
    return 260

# 名称 -> 素材 key(前端 assets/sprites 里存在的)。按"精确 -> 关键词"两级匹配。
SPRITE_BY_NAME = {
    "巨无霸": "bigmac", "麦香鸡": "mcchicken", "麦辣鸡腿汉堡": "spicy_leg", "龙焰鸡腿堡": "spicy_mcchicken",
    "板烧鸡腿堡": "teriyaki", "双层吉士汉堡": "double_cheese", "高达吉士双牛堡": "double_cheese",
    "培根蔬萃双层牛堡": "double_cheese", "不素之霸双层牛堡": "double_cheese", "芝士安格斯厚牛堡": "cheeseburger",
    "培根安格斯厚牛堡": "cheeseburger", "龙焰芝士棒鸡腿堡": "crispy_chicken", "麦香鱼": "crispy_chicken",
    "双层深海鳕鱼堡": "crispy_chicken",
    "薯条": "fries_m", "脆脆薯条": "fries_m", "脆薯饼": "hashbrown", "麦乐鸡": "nuggets5", "麦辣鸡翅": "spicy_wings",
    "麦麦脆汁鸡1块": "fried_chicken", "薄皮焦香V翅": "wings2", "派": "apple_pie",
    "可乐": "cola", "雪碧": "sprite_m", "纯悦": "cup_m", "阳光橙麦炫酷": "orange", "【美汁源】“黄金橙橙”": "orange",
    "鲜萃咖啡": "hot_coffee", "麦咖啡™美式": "hot_coffee", "麦咖啡™奶铁": "iced_coffee",
    "圆筒冰淇淋": "cone", "新地": "sundae", "经典麦旋风": "mcflurry",
    "阳光柠檬红茶": "icetea_m", "锡兰红茶": "icetea_m", "麦咖啡™奶铁": "iced_coffee",
}

# ---- 非汉堡单品: 名称关键词 -> (kind, 参数) ----
FRY = (  # kind=fry, basket 1=薯条篮 2=鸡块篮
    ("脆脆薯条", {"basket": 1, "food": "fries_pack", "salt": True}),
    ("薯条", {"basket": 1, "food": "fries_pack", "salt": True}),
    ("脆薯饼", {"basket": 2, "food": "hashbrown"}),
    ("麦乐鸡", {"basket": 2, "food": "nuggets_pile5"}),
    ("麦辣鸡翅", {"basket": 2, "food": "wings2"}),
    ("薄皮焦香V翅", {"basket": 2, "food": "wings2"}),
    ("V翅", {"basket": 2, "food": "wings2"}),
    ("麦麦脆汁鸡", {"basket": 2, "food": "drumstick"}),
    ("肉骨鸡", {"basket": 2, "food": "drumstick"}),
    ("鸡排", {"basket": 2, "food": "drumstick"}),
    ("鸡块", {"basket": 2, "food": "nuggets_pile5"}),
    ("派", {"basket": 2, "food": "apple_pie"}),
)
DRINK = (  # kind=drink
    ("可乐", {"color": "#4a2016"}), ("雪碧", {"color": "#cfe9c9"}), ("纯悦", {"color": "#e8f4ff"}),
    ("橙", {"color": "#ffae17"}), ("红茶", {"color": "#b5651d"}),
    ("美式", {"color": "#2b1608", "steam": True}), ("鲜萃咖啡", {"color": "#2b1608", "steam": True}),
    ("奶铁", {"color": "#a9784b", "ice": True}),
)
SOFT = (  # kind=soft, style cone / sundae / flurry
    ("圆筒冰淇淋", {"style": "cone"}), ("新地", {"style": "sundae"}), ("麦旋风", {"style": "flurry"}),
)

COMBO_WORDS = ("套餐", "件套", "随心", "精选", "专享", "乐园", "分享", "拼盘", "四宫格", "双人", "全家", "组合", "桶", "盒装")
NON_FOOD = ("挠", "贴", "帽", "券", "周边", "玩具", "咖啡豆")


@dataclass
class KitchenItem:
    id: str                  # 真实餐品 code(也是下单用的 productCode)
    name: str
    price: float             # 元, 该门店实时价
    cat: str                 # 前端分类 id: burger/fries/chicken/drink/dessert/combo
    kind: str                # burger / fry / drink / soft
    sprite: str
    params: dict = field(default_factory=dict)
    approx: str = ""         # 动画与实物不完全一致时的说明

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "price": self.price, "cat": self.cat,
                "kind": self.kind, "sprite": self.sprite, "approx": self.approx, **self.params}


@dataclass
class Report:
    mapped: list[KitchenItem]
    skipped: list[tuple[str, str, str]]  # (code, name, 原因)

    def summary(self) -> dict:
        by = {}
        for it in self.mapped:
            by[it.kind] = by.get(it.kind, 0) + 1
        why = {}
        for _, _, w in self.skipped:
            why[w] = why.get(w, 0) + 1
        return {"mapped": len(self.mapped), "skipped": len(self.skipped), "by_kind": by, "skip_reasons": why}


def _is_combo(name: str) -> bool:
    return any(w in name for w in COMBO_WORDS)


def _match(table, name: str):
    for kw, params in table:
        if kw in name:
            return params
    return None


# 没有精确对应素材时的中性兜底: 用通用杯子/通用图, 并标注"近似", 不冒用别的商品的图
NEUTRAL = {"drink": "cup_m", "soft": "mcflurry", "fry": None, "burger": "burger"}


def map_meal(m: Meal) -> tuple[KitchenItem | None, str]:
    """单个真实餐品 -> 动画定义。返回 (定义, 跳过原因); 成功时原因为空。"""
    item, why = _map_meal(m)
    if item:
        item.params = dict(item.params)
        item.params.setdefault("kcal", _estimate_kcal(m))
    if item and not item.approx and m.name not in SPRITE_BY_NAME and m.code not in BURGER_ING:
        # 流程参数是按关键词匹配出来的, 素材却没有精确对应: 能换中性图就换, 并一律标注"近似"
        neutral = NEUTRAL.get(item.kind)
        if neutral and item.sprite != neutral:
            item.sprite = neutral
        item.approx = "没有专属素材,用相近的图代替"
    return item, why


def _map_meal(m: Meal) -> tuple[KitchenItem | None, str]:
    if any(w in m.name for w in NON_FOOD):
        return None, "非餐品(周边/券)"
    if _is_combo(m.name):
        return None, "套餐/组合: 需拆成多个单品, 价格与优惠由后端结算, 暂不做动画"
    sprite = SPRITE_BY_NAME.get(m.name)

    if m.code in BURGER_ING:
        return KitchenItem(m.code, m.name, m.cart_price, "burger", "burger", sprite or "burger",
                           {"ing": BURGER_ING[m.code]}, APPROX.get(m.code, "")), ""
    if "堡" in m.name or "汉堡" in m.name or m.name == "巨无霸":
        return None, "汉堡但缺少已核对的配料序列"

    p = _match(FRY, m.name)
    if p is not None:
        cat = "fries" if p.get("basket") == 1 else "chicken"
        return KitchenItem(m.code, m.name, m.cart_price, cat, "fry", sprite or p["food"], p), ""
    p = _match(SOFT, m.name)
    if p is not None:
        return KitchenItem(m.code, m.name, m.cart_price, "dessert", "soft", sprite or "sundae", p), ""
    p = _match(DRINK, m.name)
    if p is not None:
        return KitchenItem(m.code, m.name, m.cart_price, "drink", "drink", sprite or "cola", p), ""
    return None, "没有对应的后厨动画流程"


def build_menu(meals: list[Meal]) -> Report:
    """一家店的完整菜单 -> 前端可用的商品列表。已按 code 去重, 麦金卡专享品不输出(价格对非会员不成立)。"""
    mapped, skipped, seen = [], [], set()
    for m in meals:
        if m.code in seen:
            continue
        seen.add(m.code)
        if m.member_only:
            skipped.append((m.code, m.name, "麦金卡专享价, 非会员实际按原价"))
            continue
        item, why = map_meal(m)
        if item:
            mapped.append(item)
        else:
            skipped.append((m.code, m.name, why))
    return Report(mapped, skipped)
