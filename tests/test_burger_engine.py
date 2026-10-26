"""匹配引擎单元测试。不联网, 用 data/ 下的长春全市快照。

运行: python -m unittest tests.test_burger_engine -v
"""
import unittest
from collections import defaultdict

from app.burger.engine import BurgerEngine
from app.burger.game import parse_selection, state_json
from app.burger.recipes import (
    PATTY,
    SPEC,
    TOPPING,
    Ingredient,
    calorie_level,
    ingredient_nutrition,
    load_recipes,
    stack_nutrition,
)


def P(n): return Ingredient(n, PATTY)
def S(n): return Ingredient(n, SPEC)
def T(n): return Ingredient(n, TOPPING)


class EngineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipes = load_recipes()
        cls.eng = BurgerEngine(cls.recipes)
        # 覆盖最全的一家店, 和一家只卖少数汉堡的店
        cnt = defaultdict(int)
        for r in cls.recipes:
            for s in r.stores:
                cnt[s] += 1
        cls.full = max(cnt, key=cnt.get)
        cls.small = min(cnt, key=cnt.get)

    def opt(self, st, ing):
        return next(o for o in st.options if o.ingredient == ing)

    # --- 数据 ---
    def test_数据加载(self):
        self.assertEqual(len(self.recipes), 14)
        self.assertTrue(all(r.patty and r.spec for r in self.recipes))

    def test_规格让所有汉堡可区分(self):
        seen = {}
        for r in self.recipes:
            self.assertNotIn(r.parts, seen, f"{r.name} 与 {seen.get(r.parts)} 食材完全相同")
            seen[r.parts] = r.name

    def test_排除项不进入玩法(self):
        names = {r.name for r in self.recipes}
        self.assertNotIn("酥酥多笋卷", names)
        self.assertNotIn("三文鱼双虾至尊月堡", names)

    def test_每个汉堡都有至少一家门店的价格(self):
        for r in self.recipes:
            self.assertTrue(r.prices, r.name)

    # --- 营养与卡路里指标 ---
    def test_每个食材与汉堡都有卡路里和三大营养素(self):
        for ing in self.eng.universe(None):
            info = ingredient_nutrition(ing.name)
            self.assertGreaterEqual(info["kcal"], 0)
            self.assertIn("protein", info)
            self.assertIn("fat", info)
            self.assertIn("carb", info)
        for r in self.recipes:
            nutri = r.nutrition
            self.assertGreater(nutri["kcal"], 250, r.name)
            self.assertGreater(nutri["protein"], 10, r.name)
            self.assertIn(nutri["level"], ("light", "balanced", "hearty", "indulgent"))

    def test_堆叠热量随食材实时累加且封顶增加面包顶热量(self):
        n0 = stack_nutrition([], include_top_bun=False)
        n1 = stack_nutrition([P("牛肉"), S("双层牛肉饼")], include_top_bun=False)
        n2 = stack_nutrition([P("牛肉"), S("双层牛肉饼")], include_top_bun=True)
        self.assertEqual(n0["kcal"], ingredient_nutrition("面包底")["kcal"])
        self.assertGreater(n1["kcal"], n0["kcal"])
        self.assertEqual(n2["kcal"] - n1["kcal"], ingredient_nutrition("面包顶")["kcal"])
        self.assertEqual(calorie_level(350)["level"], "light")
        self.assertEqual(calorie_level(800)["level"], "indulgent")

    def test_工坊接口返回实时营养仪表盘数据(self):
        sel = parse_selection([
            {"name": "鸡肉", "kind": PATTY},
            {"name": "鸡腿排", "kind": SPEC},
            {"name": "烤味酱", "kind": TOPPING},
            {"name": "生菜", "kind": TOPPING},
        ])
        st = state_json(self.eng, sel, self.full)
        self.assertIn("nutrition", st)
        self.assertTrue(st["nutrition"]["hasTopBun"])
        self.assertEqual(st["nutrition"]["kcal"], st["exact"][0]["kcal"])
        self.assertTrue(all("kcal" in o for o in st["options"]))

    # --- 步骤 ---
    def test_步骤顺序(self):
        self.assertEqual(self.eng.evaluate(set()).step, "主料")
        self.assertEqual(self.eng.evaluate({P("牛肉")}).step, "规格")
        self.assertEqual(self.eng.evaluate({P("牛肉"), S("厚牛排")}).step, "配料")

    # --- 置灰 ---
    def test_空选时全部可选(self):
        st = self.eng.evaluate(set(), self.full)
        self.assertTrue(all(o.selectable for o in st.options))
        self.assertEqual(st.exact, ())

    def test_选牛肉后鱼肉鸡肉置灰且带原因(self):
        st = self.eng.evaluate({P("牛肉")}, self.full)
        for n in ("鱼肉", "鸡肉"):
            o = self.opt(st, P(n))
            self.assertFalse(o.selectable)
            self.assertIn("牛肉", o.reason)

    def test_选规格后其它主料下的规格置灰(self):
        st = self.eng.evaluate({P("牛肉"), S("厚牛排")}, self.full)
        self.assertFalse(self.opt(st, S("鸡腿排")).selectable)
        self.assertTrue(self.opt(st, S("厚牛排")).selected)

    def test_配料冲突置灰(self):
        st = self.eng.evaluate({T("巨无霸酱")}, self.full)
        self.assertFalse(self.opt(st, T("番茄酱")).selectable)
        self.assertTrue(self.opt(st, T("酸黄瓜")).selectable)

    # --- 匹配 ---
    def test_恰好拼出板烧鸡腿堡(self):
        sel = {P("鸡肉"), S("鸡腿排"), T("烤味酱"), T("生菜")}
        st = self.eng.evaluate(sel, self.full)
        self.assertEqual([r.name for r in st.exact], ["板烧鸡腿堡"])
        self.assertEqual(st.step, "完成")

    def test_龙焰与龙焰芝士棒靠规格区分(self):
        base = {P("鸡肉"), T("生菜"), T("辣椒黄油风味酱")}
        a = self.eng.evaluate(base | {S("鸡腿排")}, self.full)
        b = self.eng.evaluate(base | {S("芝士棒鸡腿排")}, self.full)
        self.assertEqual([r.name for r in a.exact], ["龙焰鸡腿堡"])
        self.assertEqual([r.name for r in b.exact], ["龙焰芝士棒鸡腿堡"])

    def test_子集不等于完成(self):
        st = self.eng.evaluate({P("鸡肉"), S("鸡腿排"), T("生菜")}, self.full)
        self.assertEqual(st.exact, ())

    def test_提示再加一样就是某汉堡(self):
        st = self.eng.evaluate({P("鸡肉"), S("鸡腿排"), T("烤味酱")}, self.full)
        self.assertIn(("生菜", "板烧鸡腿堡"), {(h.add.name, h.burger.name) for h in st.hints})

    def test_无法拼出时给最接近的(self):
        st = self.eng.evaluate({P("牛肉"), P("鱼肉")}, self.full)
        self.assertEqual(st.reachable, ())
        self.assertTrue(st.nearest)

    def test_选了置灰项也不崩(self):
        st = self.eng.evaluate({P("牛肉"), T("烤味酱")}, self.full)
        self.assertEqual(st.reachable, ())

    def test_可达集合单调不增(self):
        a = self.eng.evaluate({P("牛肉")}, self.full)
        b = self.eng.evaluate({P("牛肉"), T("吉士")}, self.full)
        self.assertLessEqual({r.code for r in b.reachable}, {r.code for r in a.reachable})

    # --- 门店过滤 ---
    def test_门店过滤只留该店有售的汉堡(self):
        full = self.eng.evaluate(set(), self.full).reachable
        small = self.eng.evaluate(set(), self.small).reachable
        self.assertLess(len(small), len(full))
        for r in small:
            self.assertIn(self.small, r.stores)

    def test_小店里没有的食材整体置灰(self):
        # 在小店里, 全城存在但该店没有汉堡用到的食材, 不应出现在可选项里
        small_ings = {o.ingredient for o in self.eng.evaluate(set(), self.small).options}
        all_ings = {o.ingredient for o in self.eng.evaluate(set(), None).options}
        self.assertLess(len(small_ings), len(all_ings))

    def test_随机合法点选不会走进死路(self):
        import random
        random.seed(3)
        for store in (self.full, self.small, None):
            for _ in range(300):
                sel = set()
                while True:
                    st = self.eng.evaluate(sel, store)
                    ok = [o.ingredient for o in st.options if o.selectable and not o.selected]
                    if st.exact and (not ok or random.random() < 0.4):
                        break
                    if not ok:
                        break
                    sel.add(random.choice(ok))
                self.assertTrue(self.eng.evaluate(sel, store).exact, f"死路 store={store} sel={sel}")


if __name__ == "__main__":
    unittest.main()
