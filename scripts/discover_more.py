"""在已有门店基础上, 用已知门店的地址/路名作为新关键词滚雪球式补搜 (只读)。"""
import asyncio, json, re, sys
from pathlib import Path
from app.mcd_client import McdClient

async def main(city: str, rounds: int) -> None:
    path = Path("data/stores_changchun.json")
    stores = {s["storeCode"]: s for s in json.loads(path.read_text(encoding="utf-8"))}
    m = McdClient(); await m.start()
    tried: set[str] = set()
    for rd in range(rounds):
        # 从已知门店的名称/地址里抽路名、商圈名, 当作新的搜索词
        kws = set()
        for s in list(stores.values()):
            nm = re.sub(r"^麦当劳|餐厅$|^长春", "", s["name"])
            if len(nm) >= 2: kws.add(nm)
            for part in re.findall(r"[一-龥]{2,8}(?:路|街|大道|广场|大厦|中心|商城|校区)", s.get("address") or ""):
                kws.add(part)
        kws -= tried
        before = len(stores)
        for kw in sorted(kws):
            tried.add(kw)
            r = await m.call("query-nearby-stores", {"beType": 1, "searchType": 2, "city": city, "keyword": kw})
            for x in r.get("data") or []:
                if x["storeCode"] not in stores:
                    stores[x["storeCode"]] = {"storeCode": x["storeCode"], "name": x["storeName"], "address": x.get("address"),
                        "open": x.get("businessStatus"), "hours": f'{x.get("businessStartTime")}-{x.get("businessEndTime")}', "via": kw}
        print(f"第{rd+1}轮: 搜了{len(kws)}个词, 门店 {before} -> {len(stores)}")
        if len(stores) == before: break
    path.write_text(json.dumps(list(stores.values()), ensure_ascii=False, indent=1), encoding="utf-8")
    await m.stop()

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], int(sys.argv[2])))
