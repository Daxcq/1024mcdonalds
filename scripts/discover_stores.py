"""用多个地标关键词搜索某城市的门店并去重 (只读)。
用法: python -m scripts.discover_stores 长春
"""
import asyncio, json, sys
from pathlib import Path
from app.mcd_client import McdClient

KEYWORDS = ["重庆路", "红旗街", "桂林路", "长春站", "东北师范大学", "吉林大学", "净月潭", "高新区", "宽城区", "二道区",
            "绿园区", "朝阳区", "南关区", "汽车产业开发区", "经开区", "万达广场", "欧亚卖场", "龙嘉机场", "长春西站", "东北亚"]

async def main(city: str) -> None:
    m = McdClient(); await m.start()
    stores: dict[str, dict] = {}
    for kw in KEYWORDS:
        r = await m.call("query-nearby-stores", {"beType": 1, "searchType": 2, "city": city, "keyword": kw})
        got = r.get("data") or []
        new = 0
        for s in got:
            if s["storeCode"] not in stores:
                stores[s["storeCode"]] = {"storeCode": s["storeCode"], "name": s["storeName"], "address": s.get("address"),
                                          "open": s.get("businessStatus"), "hours": f'{s.get("businessStartTime")}-{s.get("businessEndTime")}', "via": kw}
                new += 1
        print(f"{kw:<10} 返回{len(got):>2} 新增{new:>2} 累计{len(stores)}" + ("" if got else f"  ({r.get('message')})"))
    Path("data/stores_changchun.json").write_text(json.dumps(list(stores.values()), ensure_ascii=False, indent=1), encoding="utf-8")
    await m.stop()

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
