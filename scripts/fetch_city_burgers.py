"""拉取某城市全部门店的汉堡单品原始数据 (只读), 存 data/city_burgers_<tag>.json。
门店打烊时用 reservationDate 取次日午餐时段的菜单。
用法: python -m scripts.fetch_city_burgers data/stores_changchun.json changchun "2026-10-25 12:00"
"""
import asyncio, json, sys
from pathlib import Path
from app.mcd_client import McdClient
from app.menu import parse_menu
from scripts.fetch_burger_raw import BURGER_CATS, COMBO

async def one(m, store, resv):
    sc = {"storeCode": store, "orderType": 1, "beType": 1}
    if resv: sc["reservationDate"] = resv
    r = await m.call("query-meals", sc)
    meals = parse_menu(r)
    if not meals:
        return {"store": store, "error": r.get("message"), "items": []}
    cand = [x for x in meals if any(c in x.categories for c in BURGER_CATS) and not any(k in x.name for k in COMBO)]
    items = []
    for x in cand:
        d = (await m.call("query-meal-detail", {**sc, "code": x.code})).get("data") or {}
        items.append({"code": x.code, "name": x.name, "price": x.price, "originalPrice": x.original_price,
                      "image": x.image, "tags": x.tags, "categories": x.categories, "detail": d})
    return {"store": store, "meal_count": len(meals), "items": items}

async def main(stores_file, tag, resv):
    stores = json.loads(Path(stores_file).read_text(encoding="utf-8"))
    m = McdClient(); await m.start()
    res = []
    for i, s in enumerate(stores, 1):
        try:
            r = await one(m, s["storeCode"], resv)
        except Exception as e:
            r = {"store": s["storeCode"], "error": f"{type(e).__name__}: {e}", "items": []}
        r["name"] = s["name"]; res.append(r)
        print(f'{i:>2}/{len(stores)} {s["storeCode"]} {s["name"][:16]:<16} 汉堡{len(r["items"]):>2}  {r.get("error") or ""}', flush=True)
    Path(f"data/city_burgers_{tag}.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    await m.stop()

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
