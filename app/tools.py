"""agent 可用的工具。注意: 这里没有 create_order, 下单只能走 server 的确认接口。"""
from .mcd_client import McdClient
from .menu import attach_kcal, panel_group, parse_menu, parse_nutrition, search
from .session import Session, Store

TOOL_SPECS = [
    {
        "name": "search_stores",
        "description": "按城市+地点关键词搜索可到店取餐的门店。用户还没选门店时先调用。",
        "input_schema": {
            "type": "object",
            "properties": {
                "city": {"type": "string"},
                "keyword": {"type": "string", "description": "地标/商圈/路名"},
            },
            "required": ["city", "keyword"],
        },
    },
    {
        "name": "select_store",
        "description": "选定门店并加载该店菜单。必须在搜索结果里的 storeCode 中选。",
        "input_schema": {
            "type": "object",
            "properties": {"store_code": {"type": "string"}},
            "required": ["store_code"],
        },
    },
    {
        "name": "search_menu",
        "description": "在已加载的菜单里检索。可按关键词、价格上限、分类过滤。分类: 汉堡/炸鸡小食/饮料/甜品/套餐。",
        "input_schema": {
            "type": "object",
            "properties": {
                "keyword": {"type": "string"},
                "max_price": {"type": "number"},
                "group": {"type": "string", "enum": ["汉堡", "炸鸡小食", "饮料", "甜品", "套餐"]},
                "limit": {"type": "integer"},
                "include_member_card": {
                    "type": "boolean",
                    "description": "是否包含麦金卡专享餐品。默认不含; 仅当顾客说自己有麦金卡时才设为 true。",
                },
            },
        },
    },
    {
        "name": "get_meal_detail",
        "description": "查看某个餐品(尤其套餐)的组成与可替换项。用户问套餐里有什么、能不能换时用。",
        "input_schema": {
            "type": "object",
            "properties": {"code": {"type": "string"}},
            "required": ["code"],
        },
    },
    {
        "name": "get_nutrition",
        "description": "按餐品名称查热量/蛋白质/脂肪等。仅覆盖单品, 套餐常查不到。",
        "input_schema": {
            "type": "object",
            "properties": {"names": {"type": "array", "items": {"type": "string"}}},
            "required": ["names"],
        },
    },
    {
        "name": "cart_add",
        "description": "把餐品加入购物车。code 必须来自 search_menu 的结果。",
        "input_schema": {
            "type": "object",
            "properties": {"code": {"type": "string"}, "quantity": {"type": "integer", "minimum": 1}},
            "required": ["code"],
        },
    },
    {
        "name": "cart_set_quantity",
        "description": "修改购物车里某餐品数量, 数量为 0 即移除。",
        "input_schema": {
            "type": "object",
            "properties": {"code": {"type": "string"}, "quantity": {"type": "integer", "minimum": 0}},
            "required": ["code", "quantity"],
        },
    },
    {
        "name": "cart_clear",
        "description": "清空购物车。",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "calculate_price",
        "description": "对当前购物车算价(含优惠)并生成待确认订单。算完要把总价告诉用户, 由用户在界面上点'确认下单'。你不能替用户下单。",
        "input_schema": {"type": "object", "properties": {}},
    },
]


def _brief(m) -> dict:
    d = {"code": m.code, "name": m.name, "price": m.cart_price, "group": panel_group(m)}
    if m.member_only:
        d["memberCardPrice"] = m.price
        d["note"] = "麦金卡会员价, 非会员按原价"
    elif m.original_price > m.price:
        d["originalPrice"] = m.original_price
    if m.tags:
        d["tags"] = m.tags
    if m.kcal:
        d["kcal"] = m.kcal
    return d


async def run_tool(name: str, args: dict, s: Session, mcd: McdClient) -> dict:
    if name == "search_stores":
        r = await mcd.call(
            "query-nearby-stores",
            {"beType": 1, "searchType": 2, "city": args["city"], "keyword": args["keyword"]},
        )
        stores = [
            {
                "storeCode": x["storeCode"],
                "name": x["storeName"],
                "address": x.get("address"),
                "distance": x.get("distance"),
                "open": x.get("businessStatus"),
                "hours": f'{x.get("businessStartTime")}-{x.get("businessEndTime")}',
            }
            for x in (r.get("data") or [])[:8]
        ]
        return {"stores": stores} if stores else {"error": r.get("message", "没有找到门店")}

    if name == "select_store":
        code = args["store_code"]
        s.store = Store(store_code=code, name=code)
        r = await mcd.call("query-meals", s.store.scope())
        meals = parse_menu(r)
        if not meals:
            s.store = None
            return {"error": r.get("message", "该门店菜单为空")}
        if not s.nutrition:
            s.nutrition = parse_nutrition(await mcd.call("list-nutrition-foods"))
        attach_kcal(meals, s.nutrition)
        s.menu = {m.code: m for m in meals}
        s.cart.clear()
        s.pending_order = None
        return {"ok": True, "store_code": code, "meal_count": len(meals)}

    if not s.store:
        return {"error": "还没选门店, 请先 search_stores / select_store"}

    if name == "search_menu":
        res = search(
            list(s.menu.values()),
            args.get("keyword", ""),
            args.get("max_price"),
            args.get("group"),
            args.get("limit", 12),
            args.get("include_member_card", False),
        )
        return {"meals": [_brief(m) for m in res]}

    if name == "get_meal_detail":
        r = await mcd.call(
            "query-meal-detail",
            {**s.store.scope(), "code": args["code"]},
        )
        d = r.get("data")
        if not d:
            return {"error": r.get("message", "查询失败")}
        rounds = [
            {
                "name": rd.get("name"),
                "choices": [
                    {"code": c["code"], "name": c["name"], "default": c.get("isDefault") == 1, "diff": c.get("diffPrice")}
                    for c in rd.get("choices", [])
                ],
            }
            for rd in d.get("rounds", [])
        ]
        return {"name": d.get("name"), "rounds": rounds}

    if name == "get_nutrition":
        out = {}
        for n in args["names"]:
            hit = s.nutrition.get(n) or next((v for k, v in s.nutrition.items() if n in k or k in n), None)
            out[n] = hit or "无数据"
        return out

    if name == "cart_add":
        m = s.menu.get(args["code"])
        if not m:
            return {"error": "菜单里没有这个 code, 请先 search_menu"}
        s.cart.add(m.code, m.name, m.cart_price, args.get("quantity", 1))
        s.pending_order = None
        return {"cart": s.cart.to_dict()}

    if name == "cart_set_quantity":
        s.cart.set_quantity(args["code"], args["quantity"])
        s.pending_order = None
        return {"cart": s.cart.to_dict()}

    if name == "cart_clear":
        s.cart.clear()
        s.pending_order = None
        return {"cart": s.cart.to_dict()}

    if name == "calculate_price":
        if not s.cart.lines:
            return {"error": "购物车是空的"}
        r = await mcd.call("calculate-price", {**s.store.scope(), "items": s.cart.items_for_mcp()})
        d = r.get("data")
        if not d:
            return {"error": r.get("message", "算价失败")}
        s.pending_order = {
            "original": d["originalPrice"] / 100,
            "discount": d["discount"] / 100,
            "price": d["price"] / 100,
            "takeWayList": d.get("takeWayList", []),
            "items": s.cart.items_for_mcp(),
        }
        return {"price_yuan": s.pending_order["price"], "discount_yuan": s.pending_order["discount"],
                "take_ways": [t["title"] for t in s.pending_order["takeWayList"]],
                "note": "已生成待确认订单, 请提示用户在界面点击确认"}

    return {"error": f"未知工具 {name}"}
