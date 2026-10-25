"""拉取某城市门店的汉堡单品原始数据 (只读), 增量写入 data/city_burgers_<tag>.json。

增量规则
- 已经有汉堡数据的门店默认跳过(不重复请求, 也不会被覆盖); 加 --refresh 才全部重拉。
- 先不带预约时间请求(营业时段直接成功); 失败再退到 reservationDate(打烊店取次日午餐菜单)。
- 写文件前合并: 本次失败的店不会把旧数据冲掉。

用法(项目根目录):
    python -m scripts.fetch_city_burgers data/stores_changchun.json changchun
    python -m scripts.fetch_city_burgers data/stores_changchun.json changchun --refresh
    python -m scripts.fetch_city_burgers data/stores_changchun.json changchun --resv "2026-10-26 12:00"
"""
import argparse
import asyncio
import json
from pathlib import Path

from app.mcd_client import McdClient, McdUnavailable
from app.menu import parse_menu
from scripts.fetch_burger_raw import BURGER_CATS, COMBO


async def one(m, store, resv):
    """先不带预约, 再退到预约。返回 (记录, 使用的方式)。"""
    last = None
    for r_ in (None, resv) if resv else (None,):
        sc = {"storeCode": store, "orderType": 1, "beType": 1}
        if r_:
            sc["reservationDate"] = r_
        r = await m.call("query-meals", sc)
        meals = parse_menu(r)
        if not meals:
            last = r.get("message")
            continue
        cand = [x for x in meals if any(c in x.categories for c in BURGER_CATS) and not any(k in x.name for k in COMBO)]
        items = []
        for x in cand:
            d = (await m.call("query-meal-detail", {**sc, "code": x.code})).get("data") or {}
            items.append({"code": x.code, "name": x.name, "price": x.price, "originalPrice": x.original_price,
                          "image": x.image, "tags": x.tags, "categories": x.categories, "detail": d})
        return {"store": store, "meal_count": len(meals), "items": items}, ("预约" if r_ else "直接")
    return {"store": store, "error": last, "items": []}, "失败"


async def main(stores_file, tag, resv, refresh):
    stores = json.loads(Path(stores_file).read_text(encoding="utf-8"))
    out = Path(f"data/city_burgers_{tag}.json")
    old = {r["store"]: r for r in json.loads(out.read_text(encoding="utf-8"))} if out.exists() else {}

    todo = [s for s in stores if refresh or not old.get(s["storeCode"], {}).get("items")]
    print(f"门店 {len(stores)} 家, 已有数据 {sum(1 for r in old.values() if r.get('items'))} 家, 本次需要请求 {len(todo)} 家")
    if not todo:
        return

    m = McdClient()
    gained = 0
    try:
        for i, s in enumerate(todo, 1):
            try:
                rec, how = await one(m, s["storeCode"], resv)
            except McdUnavailable as e:
                print(f"麦当劳接口不可用, 已停止(已完成的部分会保存): {e}")
                break
            except Exception as e:  # noqa: BLE001 - 单店失败不影响其他店
                rec, how = {"store": s["storeCode"], "error": f"{type(e).__name__}: {e}", "items": []}, "异常"
            rec["name"] = s["name"]
            prev = old.get(s["storeCode"])
            if rec["items"]:
                old[s["storeCode"]] = rec
                gained += 1
            elif not (prev and prev.get("items")):
                old[s["storeCode"]] = rec          # 之前也没有数据时才记录失败原因; 有旧数据则保留旧数据
            print(f'{i:>2}/{len(todo)} {s["storeCode"]} {s["name"][:16]:<16} {how:<2} 汉堡{len(rec["items"]):>2}  {rec.get("error") or ""}', flush=True)
    finally:
        # 按门店清单的顺序写回, 保持文件稳定
        merged = [old[s["storeCode"]] for s in stores if s["storeCode"] in old]
        out.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
        await m.stop()
    have = sum(1 for r in merged if r.get("items"))
    print(f"\n本次新增 {gained} 家; 现共有数据 {have}/{len(stores)} 家")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stores_file")
    ap.add_argument("tag")
    ap.add_argument("--resv", default=None, help="直接请求失败时退到的预约时间, 如 '2026-10-26 12:00'")
    ap.add_argument("--refresh", action="store_true", help="重拉所有门店")
    a = ap.parse_args()
    asyncio.run(main(a.stores_file, a.tag, a.resv, a.refresh))
