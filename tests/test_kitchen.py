"""真实菜单 -> 后厨动画 映射层测试。不联网。

运行(在项目根目录): python -m unittest tests.test_kitchen -v
"""
import json
import unittest
from pathlib import Path

from app.kitchen import BURGER_ING, KITCHEN_ING, SPRITE_BY_NAME, build_menu, map_meal
from app.menu import Meal

ROOT = Path(__file__).resolve().parent.parent
SPRITES = {p.stem for p in (ROOT / "assets" / "sprites").glob("*.png") if not p.stem.endswith("_ghost")}


def meal(code, name, price=10.0, orig=None, tags=None, cats=None):
    return Meal(code=code, name=name, price=price, original_price=orig if orig is not None else price,
                tags=tags or [], categories=cats or [])


class KitchenMapTest(unittest.TestCase):
    def test_配料词表不越界(self):
        used = {i for seq in BURGER_ING.values() for i in seq}
        self.assertLessEqual(used, KITCHEN_ING)

    def test_引用的素材文件都存在(self):
        self.assertLessEqual(set(SPRITE_BY_NAME.values()), SPRITES)

    def test_汉堡映射保留真实code和价格(self):
        it, why = map_meal(meal("1100", "巨无霸", 26.0))
        self.assertEqual(why, "")
        self.assertEqual((it.id, it.kind, it.cat, it.price), ("1100", "burger", "burger", 26.0))
        self.assertIn("beef", it.params["ing"])

    def test_价格用门店实时价而不是前端写死的价(self):
        a, _ = map_meal(meal("1100", "巨无霸", 26.0))
        b, _ = map_meal(meal("1100", "巨无霸", 29.0))
        self.assertNotEqual(a.price, b.price)

    def test_套餐不输出(self):
        it, why = map_meal(meal("9", "巨无霸三件套", 37.0))
        self.assertIsNone(it)
        self.assertIn("套餐", why)

    def test_麦金卡专享品不输出(self):
        rep = build_menu([meal("1100", "巨无霸", 26.0, 26.0, tags=["麦金卡"])])
        self.assertEqual(rep.mapped, [])
        self.assertIn("麦金卡", rep.skipped[0][2])

    def test_周边不当作餐品(self):
        it, why = map_meal(meal("8", "“葱不求人“按摩捶痒痒挠", 14.9))
        self.assertIsNone(it)

    def test_未核对配料的汉堡不硬凑(self):
        it, why = map_meal(meal("521731", "枫糖风味厚松饼猪柳堡", 18.0))
        self.assertIsNone(it)
        self.assertIn("配料", why)

    def test_没有鱼排素材时必须标注近似(self):
        it, _ = map_meal(meal("1600", "麦香鱼", 23.0))
        self.assertTrue(it.approx)

    def test_没有专属素材时用中性图并标注(self):
        it, _ = map_meal(meal("77", "阳光柠檬红茶不存在的变体", 9.5))
        self.assertIsNotNone(it)
        self.assertTrue(it.approx)
        self.assertIn(it.sprite, SPRITES)

    def test_同code去重(self):
        rep = build_menu([meal("1100", "巨无霸", 26.0), meal("1100", "巨无霸", 26.0)])
        self.assertEqual(len(rep.mapped), 1)

    def test_输出可被JSON序列化且字段齐全(self):
        rep = build_menu([meal("1100", "巨无霸", 26.0), meal("5", "可乐", 9.5)])
        for it in rep.mapped:
            d = json.loads(json.dumps(it.to_dict(), ensure_ascii=False))
            for k in ("id", "name", "price", "cat", "kind", "sprite"):
                self.assertIn(k, d)
            self.assertIn(it.sprite, SPRITES)

    def test_真实长春菜单覆盖率不低于基线(self):
        p = Path("/tmp/changchun_menu.json")
        if not p.exists():
            self.skipTest("没有菜单快照")
        raw = json.loads(p.read_text(encoding="utf-8"))
        ms = [Meal(code=d["code"], name=d["name"], price=d["price"], original_price=d["originalPrice"],
                   image=d["image"], tags=d["tags"], categories=d["categories"]) for d in raw]
        rep = build_menu(ms)
        self.assertGreaterEqual(len(rep.mapped), 30)
        for it in rep.mapped:
            self.assertIn(it.sprite, SPRITES, it.name)


if __name__ == "__main__":
    unittest.main()
