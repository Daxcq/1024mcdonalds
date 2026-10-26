/* 数据层测试：node tools/fp_data_test.js （项目根目录下运行） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

const ctx = {};                 // 沙箱里 window 就是上下文本身，脚本写的 window.X 会挂到 ctx 上
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/fp_sprites.js', 'js/fp_data.js', 'js/fp_recipes.js', 'js/fp_rules.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const FP = ctx.FP;
let bad = 0;
const ok = (cond, msg, extra) => {
  if (!cond) { bad++; console.log('FAIL ' + msg + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
  else console.log('ok   ' + msg);
};

// 1. 配料表
ok(FP.ING_LIST.length === 52, '52 种配料', FP.ING_LIST.length);
const ids = FP.ING_LIST.map((i) => i.id);
ok(ids.every((id, i) => id === 'I' + String(i + 1).padStart(2, '0')), '编号连续 I01..I52');
const spr = ctx.window === undefined ? null : null;
const SPR = vm.runInContext('window.FP_SPR', ctx);
const missingPng = ids.filter((id) => !fs.existsSync(path.join(ROOT, 'assets/fp/ing', id + '.png')));
ok(missingPng.length === 0, '每个配料都有 png', missingPng);
const missingSpr = ids.filter((id) => !SPR[id]);
ok(missingSpr.length === 0, '每个配料都在 fp_sprites.js 里', missingSpr);
const catIds = FP.CATS.map((c) => c.id);
ok(FP.ING_LIST.every((i) => catIds.includes(i.cat)), '分类合法');
ok(FP.CATS.every((c) => FP.ingByCat(c.id).length > 0), '每个分类都有料');

// 2. 食谱
ok(FP.RECIPES.length === 20, '20 个食谱', FP.RECIPES.length);
const bunBad = FP.RECIPES.filter((r) => {
  const s = r.stack;
  return FP.ING[s[0]].role !== 'bunBottom' || FP.ING[s[s.length - 1]].role !== 'bunTop' || !s.every((id) => FP.ING[id]);
});
ok(bunBad.length === 0, '食谱结构合法（底/顶面包）', bunBad.map((r) => r.id));
const badBurger = FP.RECIPES.filter((r) => !fs.existsSync(path.join(ROOT, 'assets/fp/burger', r.id + '.png')));
ok(badBurger.length === 0, '每个食谱都有成品图', badBurger.map((r) => r.id));
ok(FP.RECIPES.every((r) => r.stack.length >= 4 && r.stack.length <= 14), '层数在 4..14');
ok(FP.RECIPES.reduce((n, r) => n + (FP.matchRecipe(r.stack) === r ? 1 : 0), 0) >= 18, '至少 18 个食谱唯一匹配');
ok(FP.RECIPES.every((r) => FP.score(r, r.stack).stars === 3), '每个食谱自己做出来是 3 星');

// 3. progress
const R = FP.recipeById('B04');
const p1 = FP.progress(R, R.stack.slice(0, 3));
ok(p1.matched === 3 && !p1.wrong && p1.next === R.stack[3], 'progress 前缀匹配');
const p2 = FP.progress(R, [R.stack[0], R.stack[2]]);
ok(p2.matched === 1 && p2.wrong === true && p2.next === R.stack[1], 'progress 走错了会标红');
const p3 = FP.progress(R, R.stack);
ok(p3.done === true && p3.next === null, 'progress 完成');

// 4. 评分
const two = FP.score(FP.recipeById('B06'), ['I05', 'I13', 'I04', 'I24']);
ok(two.stars === 2 && two.orderOk === true, '顺序乱但材料对 = 2 星', two.stars);
const one = FP.score(FP.recipeById('B01'), ['I05', 'I13', 'I40', 'I04']);
ok(one.stars >= 1 && one.stars <= 2, '少一样配料不掉到 0 星', one.stars);
const zero = FP.score(FP.recipeById('B01'), ['I05', 'I37', 'I04']);
ok(zero.stars === 0, '完全不像 = 0 星', zero.stars);
ok(typeof FP.score(FP.recipeById('B01'), ['I05', 'I13', 'I04']).message === 'string', '评分有话术');

// 5. 命名
const nameCases = [
  ['B01 食谱', FP.recipeById('B01').stack],
  ['芝士厚牛', ['I05', 'I13', 'I24', 'I04']],
  ['双层', ['I05', 'I13', 'I24', 'I13', 'I04']],
  ['菠萝鸡', ['I05', 'I15', 'I37', 'I47', 'I04']],
  ['素食', ['I05', 'I28', 'I30', 'I42', 'I04']],
  ['纯面包', ['I05', 'I03', 'I04']],
  ['巨无霸改', ['I02', 'I12', 'I29', 'I24', 'I03', 'I12', 'I31', 'I01']],
];
nameCases.forEach(([label, s]) => {
  const n = FP.nameBurger(s);
  ok(n.name.length >= 2 && /堡$|面包|面包叠面包/.test(n.name), '命名 ' + label + ' -> ' + n.name, n.name);
});

// 6. 自由创作评分
const good = FP.freeScore(['I05', 'I13', 'I24', 'I30', 'I40', 'I04']);
ok(good.valid && good.stars >= 2 && good.points >= 55, '好汉堡得高分', good.points);
const noTop = FP.freeScore(['I05', 'I13']);
ok(!noTop.valid && noTop.notes.length > 0, '没盖面包 = 无效');
const noBase = FP.freeScore(['I13', 'I04']);
ok(!noBase.valid, '没有底层 = 无效');
const tall = FP.freeScore(['I05', ...Array(18).fill('I13'), 'I04']);
ok(tall.valid && tall.points < good.points, '太高的汉堡分数低', tall.points);

// 7. canPlace
ok(FP.canPlace([], 'I13').ok === false, '空盘先放面包');
ok(FP.canPlace([], 'I05').ok === true, '空盘放下层面包');
ok(FP.canPlace(['I05', 'I13', 'I04'], 'I24').ok === false, '盖上后不能再加料');
ok(FP.canPlace(['I05', 'I13', 'I04'], 'I50').ok === true, '盖上后可以撒芝麻');
ok(FP.canPlace(['I05', 'I40'], 'I41').ok === false, '酱料不能连挤两层');
ok(FP.canPlace(['I05'], 'I04').ok === false, '太早盖上面包');

// 8. 打印食谱
console.log('\n--- 食谱一览 ---');
FP.RECIPES.forEach((r) => console.log(r.id, r.name, '(' + r.stack.length + '层) :', r.stack.join(' ')));
console.log('\n' + (bad ? bad + ' FAILED' : 'ALL OK'));
process.exit(bad ? 1 : 0);
