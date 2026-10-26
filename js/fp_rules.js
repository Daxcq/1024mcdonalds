/* 汉堡小游戏 · 规则层：价格/热量、食谱对照、评分、创意命名、叠放合法性。纯函数。 */
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const FP = (G.FP = G.FP || {});
  const ING = FP.ING;
  const norm = (s) => s.map((id) => {
    const r = ING[id].role;
    return r === 'bunTop' ? 'BT' : r === 'bunBottom' ? 'BB' : r === 'bunMid' ? 'BM' : id;
  });
  const has = (it, t) => it.tags.includes(t);
  const by = (stack, pred) => stack.filter((id) => pred(ING[id]));

  FP.price = (s) => Math.round(s.reduce((a, id) => a + ING[id].price, 0) * 10) / 10;
  FP.kcal = (s) => s.reduce((a, id) => a + ING[id].kcal, 0);
  FP.names = (ids) => ids.map((id) => (ING[id] ? ING[id].name : id));

  FP.matchRecipe = (stack) =>
    FP.RECIPES.find((r) => r.stack.length === stack.length && r.stack.every((id, i) => id === stack[i])) || null;

  FP.progress = function (recipe, stack) {
    const want = norm(recipe.stack), got = norm(stack);
    let m = 0;
    while (m < want.length && m < got.length && want[m] === got[m]) m++;
    return {
      matched: m,
      wrong: m < got.length && m < want.length && want[m] !== got[m],
      next: m < recipe.stack.length ? recipe.stack[m] : null,
      done: want.length === got.length && m === want.length,
    };
  };

  /* 编辑距离（数组） */
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const multiset = (a) => a.slice().sort();
  const sameSet = (a, b) => a.length === b.length && multiset(a).every((x, i) => x === multiset(b)[i]);

  FP.score = function (recipe, stack) {
    const want = norm(recipe.stack), got = norm(stack);
    const ratio = 1 - lev(want, got) / Math.max(want.length, got.length, 1);
    const orderOk = sameSet(want, got);
    // 差集：按名字统计，给出人话
    const wantN = multiset(want), gotN = multiset(got);
    const missing = [], extra = [];
    const pool = gotN.slice();
    wantN.forEach((id) => { const i = pool.indexOf(id); if (i >= 0) pool.splice(i, 1); else missing.push(id); });
    const pool2 = wantN.slice();
    gotN.forEach((id) => { const i = pool2.indexOf(id); if (i >= 0) pool2.splice(i, 1); else extra.push(id); });
    const stars = ratio >= 1 ? 3 : orderOk || ratio >= 0.85 ? 2 : ratio >= 0.5 ? 1 : 0;
    const nm = (ids) => [...new Set(FP.names(ids.map((x) => (ING[x] ? x : x === 'BT' ? 'I01' : x === 'BB' ? 'I02' : 'I03'))))];
    let message;
    if (stars === 3) message = '和食谱一模一样，主厨落泪';
    else if (stars === 2) message = orderOk ? '东西都对，顺序再捋一捋' : '差一点点就完美了';
    else if (stars === 1) message = '有几分像了，再看看食谱';
    else message = '这份……顾客可能想退货';
    const bits = [];
    if (missing.length) bits.push('少了' + nm(missing).slice(0, 2).join('、'));
    if (extra.length) bits.push('多了' + nm(extra).slice(0, 2).join('、'));
    if (!orderOk && missing.length + extra.length === 0) bits.push('顺序不对');
    if (bits.length && stars < 3) message += '：' + bits.join('，');
    return { stars, ratio, missing, extra, orderOk, message };
  };

  /* ---------- 创意命名 ---------- */
  const PROTEIN = [
    ['shrimp', '鲜虾'], ['fish', '鳕鱼'], ['chicken', '鸡腿'], ['pork', '猪柳'], ['beef', '牛肉'],
  ];
  FP.nameBurger = function (stack) {
    const rec = FP.matchRecipe(stack);
    if (rec) return { name: rec.name, tags: rec.tags.slice() };
    const solid = stack.filter((id) => !FP.isBun(id));
    if (!solid.length) return { name: stack.length > 2 ? '面包叠面包' : '纯面包堡', tags: ['bread'] };
    const patties = solid.filter((id) => has(ING[id], 'protein'));
    const main = PROTEIN.find(([t]) => patties.some((id) => has(ING[id], t)));
    const words = [];
    if (patties.length >= 4) words.push('四层');
    else if (patties.length === 3) words.push('三层');
    else if (patties.length === 2) words.push('双层');
    const flavour = [];
    if (solid.some((id) => has(ING[id], 'cheese'))) flavour.push('芝士');
    if (solid.some((id) => has(ING[id], 'bacon'))) flavour.push('培根');
    if (solid.some((id) => has(ING[id], 'egg'))) flavour.push('煎蛋');
    if (solid.some((id) => has(ING[id], 'mushroom'))) flavour.push('蘑菇');
    if (solid.some((id) => has(ING[id], 'pineapple'))) flavour.push('菠萝');
    if (solid.some((id) => has(ING[id], 'shrimp'))) flavour.push('鲜虾');
    if (solid.some((id) => has(ING[id], 'jalapeno'))) flavour.push('墨西哥');
    words.push(...flavour.slice(0, 2));
    if (main) words.push(main[1]);
    else if (solid.some((id) => has(ING[id], 'veg'))) words.push('田园');
    else words.push('神秘');
    const body = words.join('');
    const sauce = solid.filter((id) => ING[id].role === 'sauce');
    const sauceTag = sauce.length > 1 ? '双酱' : sauce.length === 1
      ? (has(ING[sauce[0]], 'spicy') ? '辣味' : has(ING[sauce[0]], 'bbq') ? '烧烤' : has(ING[sauce[0]], 'sweet') ? '甜香' : '') : '';
    const name = (body.length > 6 ? body.slice(0, 6) : body) + sauceTag + '堡';
    const tags = [...new Set(solid.flatMap((id) => ING[id].tags))].filter((t) => t.length > 2);
    return { name, tags };
  };

  /* ---------- 自由创作评分 ---------- */
  FP.freeScore = function (stack) {
    const rec = FP.matchRecipe(stack);
    const nm = FP.nameBurger(stack).name;
    const base = { name: nm, price: FP.price(stack), kcal: FP.kcal(stack) };
    const bottomOk = stack.length > 0 && ING[stack[0]].role === 'bunBottom';
    const topOk = stack.length > 0 && ING[stack[stack.length - 1]].role === 'bunTop';
    const solid = stack.filter((id) => !FP.isBun(id));
    if (!bottomOk || !topOk || !solid.length) {
      const notes = [];
      if (!bottomOk) notes.push('先从一片下层面包开始');
      if (!solid.length) notes.push('只放面包可不叫汉堡');
      if (!topOk) notes.push('最后别忘了盖上上面包');
      return Object.assign(base, { valid: false, stars: 0, points: 0, notes });
    }
    const notes = [];
    let pts = 30;
    const cats = new Set(solid.map((id) => ING[id].cat));
    if (solid.some((id) => has(ING[id], 'protein'))) { pts += 14; notes.push('有肉有排面 +14'); }
    else { notes.push('没有肉，是素食路线'); pts -= 4; }
    if (cats.has('egg')) { pts += 8; notes.push('蛋或芝士增加层次 +8'); }
    if (cats.has('veg')) { pts += 10; notes.push('有蔬果，口感清爽 +10'); }
    if (cats.has('sauce')) { pts += 8; notes.push('酱汁到位 +8'); } else { pts -= 3; notes.push('一点酱都没有，有点干'); }
    if (cats.has('spice')) { pts += 3; notes.push('撒了点调味 +3'); }
    const n = stack.length;
    if (n >= 4 && n <= 12) { pts += 8; notes.push('层数刚好 +8'); }
    else if (n > 16) { pts -= 8; notes.push('太高了，咬不下 -8'); }
    const counts = {};
    solid.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    const worst = Math.max(0, ...Object.values(counts));
    if (worst > 3) { pts -= Math.min(12, (worst - 3) * 3); notes.push('同一种配料放太多了'); }
    const sprinkles = solid.filter((id) => ING[id].role === 'sprinkle');
    if (sprinkles.length && stack.indexOf(sprinkles[0]) < stack.length - 3) { pts -= 4; notes.push('调味料最好撒在最上面'); }
    const bonus = [
      [['bacon', 'cheese'], '培根遇见芝士 +6', 6],
      [['egg', 'bacon'], '煎蛋配培根 +5', 5],
      [['pineapple', 'chicken'], '菠萝配鸡腿，意外地搭 +6', 6],
      [['mushroom', 'beef'], '蘑菇牛肉是绝配 +6', 6],
      [['fish', 'tartar'], '炸鱼排加塔塔酱 +5', 5],
      [['spicy', 'mayo'], '辣味酱料很上头 +4', 4],
    ];
    const all = solid.flatMap((id) => ING[id].tags);
    bonus.forEach(([need, text, p]) => { if (need.every((t) => all.includes(t))) { pts += p; notes.push(text); } });
    if (rec) { pts += 10; notes.push('这就是 ' + rec.name + ' +10'); }
    pts = Math.max(0, Math.min(100, Math.round(pts)));
    const stars = pts >= 80 ? 3 : pts >= 55 ? 2 : 1;
    return Object.assign(base, { valid: true, stars, points: pts, notes: notes.slice(0, 6) });
  };

  /* ---------- 能不能再加这一层 ---------- */
  FP.canPlace = function (stack, id) {
    const it = ING[id];
    if (!it) return { ok: false, why: '没有这个配料' };
    if (stack.length >= 24) return { ok: false, why: '太高了，盘子要塌了' };
    if (!stack.length) {
      return it.role === 'bunBottom' ? { ok: true, why: '' } : { ok: false, why: '先放一片下层面包打底' };
    }
    const topId = stack[stack.length - 1], top = ING[topId];
    if (top.role === 'bunTop') {
      return it.role === 'sprinkle' ? { ok: true, why: '' } : { ok: false, why: '面包已经盖上了，想加料先撤销' };
    }
    if (it.role === 'bunBottom') return { ok: false, why: '下层面包只能放在最底下' };
    if (it.role === 'bunTop' && stack.length < 2) return { ok: false, why: '里面还空着，先放点配料' };
    if (it.role === 'sauce' && top.role === 'sauce') return { ok: false, why: '酱料挤两层会流得到处都是' };
    return { ok: true, why: '' };
  };
})();
