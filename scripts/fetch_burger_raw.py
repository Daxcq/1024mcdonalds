"""拉取一家门店全部汉堡类单品的原始详情, 存到 data/burgers_raw.json (只读调用)。
用法: python -m scripts.fetch_burger_raw <storeCode>
"""
import asyncio, json, sys
from pathlib import Path
from app.mcd_client import McdClient
from app.menu import parse_menu

COMBO = ("套餐", "件套", "随心", "精选", "专享", "乐园", "盒", "分享", "拼盘", "桶", "四宫格")
# 按 MCP 自带的分类取汉堡系, 比按名称关键词更不容易漏(如 麦香鸡/麦香鱼)
BURGER_CATS = ("鸡肉汉堡/卷", "巨无霸牛鱼肉堡", "安格斯MAX厚牛堡")

async def main(store: str) -> None:
    m = McdClient(); await m.start()
    sc = {"storeCode": store, "orderType": 1, "beType": 1}
    meals = parse_menu(await m.call("query-meals", sc))
    cand = [x for x in meals
            if any(c in x.categories for c in BURGER_CATS) and not any(k in x.name for k in COMBO)]
    out = []
    for x in cand:
        d = (await m.call("query-meal-detail", {**sc, "code": x.code})).get("data") or {}
        out.append({"code": x.code, "name": x.name, "price": x.price, "originalPrice": x.original_price,
                    "image": x.image, "tags": x.tags, "categories": x.categories, "detail": d})
    Path("data/burgers_raw.json").write_text(json.dumps({"store": store, "items": out}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("候选", len(cand), "已写入 data/burgers_raw.json")
    for o in out:
        d = o["detail"]; mod = (d.get("modification") or {}).get("items", [])
        vals = [v["name"] for it in mod for v in it.get("values", [])]
        print(f'{o["name"]:<22} ¥{o["price"]:<6} supportModify={d.get("supportModify")!s:<5} rounds={len(d.get("rounds",[]))} 配料={vals}')
    await m.stop()

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
