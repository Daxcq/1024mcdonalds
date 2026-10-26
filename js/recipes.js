/* 制作流程：每个 kind 一个 async 函数，一步一步 await。
 * 订单被取消时，正在 await 的动画会抛出 Abort，整个流程立刻中止（见 engine.js）。*/
(function (g) {
  const MD = g.MD, EASE = MD.EASE;
  const R = (MD.recipes = {});

  /* ---------- 步骤状态栏：每个商品有哪些大步骤 ----------
   * 汉堡的步骤按配料合并相邻的同类（蔬菜、酱料各算一步），否则 7 层的巨无霸会有十几格，装不下。
   * labels 给界面显示；ingStage[i] 是配方里第 i 个配料对应的步骤序号。 */
  const ING_GROUP = {
    beef: ['煎烤肉饼', 'beef'], chicken: ['炸鸡排', 'chicken'], cheese: ['放上芝士', 'cheese'],
    lettuce: ['加入蔬菜', 'veg'], tomato: ['加入蔬菜', 'veg'], pickle: ['加入蔬菜', 'veg'], onion: ['加入蔬菜', 'veg'],
    ketchup: ['挤上酱汁', 'sauce'], mayo: ['挤上酱汁', 'sauce'], mid: ['中层面包', 'mid'],
  };
  MD.stepsFor = function (def) {
    if (def.kind === 'burger') {
      const labels = ['取下面包'], ingStage = [];
      let last = null;
      for (const ing of def.ing) {
        const [name, grp] = ING_GROUP[ing];
        // 连续的蔬菜 / 酱料合并成一格；肉饼、芝士每次单独一格
        if (grp === last && (grp === 'veg' || grp === 'sauce')) { ingStage.push(labels.length - 1); continue; }
        labels.push(name); ingStage.push(labels.length - 1); last = grp;
      }
      labels.push('盖上面包', '包装出餐');
      return { labels, ingStage };
    }
    if (def.kind === 'drink') return { labels: ['拿杯子', '接饮料', '盖盖插管', '出餐'] };
    if (def.kind === 'fry') {
      const l = ['拿包装', '炸篮沥油', '铲起装盒'];
      if (def.salt) l.push('撒盐');
      l.push('出餐'); return { labels: l };
    }
    // soft
    const l = [def.style === 'cone' ? '拿甜筒' : '拿杯子', '挤冰淇淋'];
    if (def.style === 'flurry') l.push('搅拌'); else if (def.style === 'sundae') l.push('淋酱');
    l.push('出餐'); return { labels: l };
  };

  /* 走到站点 -> 伸手 -> 把东西“拿”到手上。返回手上的 prop */
  async function grab(A, st, make, text, ms = 560) {
    if (text) A.say(text);
    await A.walk(st);
    let p;
    await A.reach(MD.ST[st].src || MD.ST[st].spot, ms, () => {
      p = A.spawn(make(MD.ST[st].src || MD.ST[st].spot));
      A.pick(p);
    });
    return p;
  }
  const spr = (key, w, extra) => (pos) => Object.assign({ type: 'spr', key, x: pos[0], y: pos[1], w, scale: 1, alpha: 1 }, extra || {});

  /* ------------------------- 汉堡 ------------------------- */
  R.burger = async function (A, o, def) {
    const E = A.E, L = MD.LAYER, bs = MD.ST.board.spot;
    const S = MD.stepsFor(def), nSt = S.labels.length;
    const layNuts = MD.burgerLayersNutri ? MD.burgerLayersNutri(def) : [];
    const addNutri = (idx, px, py) => {
      const ln = layNuts[idx] || { kcal: 25, protein: 1, fat: 1, carb: 2, label: '配料' };
      burger.kcal = (burger.kcal || 0) + ln.kcal;
      burger.protein = (burger.protein || 0) + ln.protein;
      burger.fat = (burger.fat || 0) + ln.fat;
      burger.carb = (burger.carb || 0) + ln.carb;
      if (o) {
        o.liveNutri = {
          kcal: burger.kcal,
          protein: Math.round(burger.protein * 10) / 10,
          fat: Math.round(burger.fat * 10) / 10,
          carb: Math.round(burger.carb * 10) / 10,
          lastDelta: ln.kcal,
          lastLabel: ln.label,
          stepSeq: idx + 1,
        };
      }
      if (A.calPop) A.calPop(px, py, `+${ln.kcal} kcal · ${ln.label}`);
      E.emit();
    };
    A.stage(0);
    // 1. 下层面包 -> 案板
    let bun = await grab(A, 'bun', spr('bun_bottom', L.bun_bottom.w), '取下层面包');
    A.say('放到案板上');
    await A.walk('board');
    const burger = A.spawn({ type: 'burger', x: bs[0], y: bs[1], w: 76, scale: 1, alpha: 1, layers: [], cum: 0, kcal: 0, hidden: true });
    o.main = burger; o.where = 'board';
    let f;
    await A.reach([bs[0], bs[1] - 10], 520, () => { f = A.fly(bun, [bs[0], bs[1]], 260, 26); A.release(bun); });
    await f; A.remove(bun);
    burger.hidden = false; burger.layers.push({ key: 'bun_bottom' }); burger.cum += L.bun_bottom.dy;
    addNutri(0, bs[0], bs[1] - burger.cum - 18);
    A.puff(bs[0], bs[1] - 8, '#ffe9b8', 4, { speed: 24, life: 300 });
    await A.wait(150);

    // 2. 依次叠配料
    for (let ii = 0; ii < def.ing.length; ii++) {
      const ing = def.ing[ii];
      const I = MD.ING[ing], lay = L[I.key];
      A.stage(S.ingStage[ii]);
      if (ing === 'beef' || ing === 'chicken') {
        const take = await grab(A, I.st, spr(I.key, lay.w), I.take, 600);
        // 煎台翻面 / 炸锅沥油的小特效
        const src = MD.ST[I.st].src;
        A.puff(src[0], src[1] - 6, ing === 'beef' ? '#d8d8d8' : '#ffe08a', 6, { speed: 26, up: -40, g: -20, life: 500 });
        await A.wait(200);
        A.say(I.put);
        await A.walk('board');
        const top = [bs[0], bs[1] - burger.cum - 6];
        await A.reach(top, 520, () => { A.release(take); f = A.fly(take, [top[0], top[1] + 6], 230, 22); });
        await f; A.remove(take);
      } else if (ing === 'ketchup' || ing === 'mayo') {
        const bottle = await grab(A, I.st, spr(I.key, 34), I.take);
        A.say(I.put);
        await A.walk('board');
        const top = [bs[0], bs[1] - burger.cum - 18];
        await A.reach(top, 300, () => { A.release(bottle); f = A.fly(bottle, [top[0] + 4, top[1] - 4], 200, 14); });
        await f;
        // 倾斜挤酱
        const col = lay.band;
        const fxh = A.fxAdd((c) => { c.fillStyle = col; c.fillRect(top[0] - 1, top[1] + 2, 3, 16); });
        await A.anim(420, (k) => { bottle.rot = -0.9 * Math.sin(k * Math.PI); bottle.x = top[0] + 4 + 6 * Math.sin(k * 6) * 0.2; });
        A.fxRm(fxh);
        burger.layers.push({ key: I.key }); burger.cum += lay.dy;
        addNutri(ii + 1, bs[0], bs[1] - burger.cum - 18);
        await A.wait(80);
        A.remove(bottle);
      } else {
        const take = await grab(A, I.st, spr(I.key, lay.w), I.take);
        A.say(I.put);
        await A.walk('board');
        const top = [bs[0], bs[1] - burger.cum - 8];
        await A.reach(top, 480, () => { A.release(take); f = A.fly(take, [top[0], top[1] + 8], 220, 24); });
        await f; A.remove(take);
      }
      if (ing === 'beef' || ing === 'chicken') { burger.layers.push({ key: I.key }); burger.cum += lay.dy; addNutri(ii + 1, bs[0], bs[1] - burger.cum - 18); }
      else if (!(ing === 'ketchup' || ing === 'mayo')) { burger.layers.push({ key: I.key }); burger.cum += lay.dy; addNutri(ii + 1, bs[0], bs[1] - burger.cum - 18); }
      A.puff(bs[0], bs[1] - burger.cum, '#ffffff', 3, { speed: 18, life: 250, g: 0 });
      await A.wait(90);
    }

    // 3. 上层面包
    A.stage(nSt - 2);
    const tb = await grab(A, 'bun', spr('bun_top', L.bun_top.w), '取上层面包');
    A.say('盖上上层面包');
    await A.walk('board');
    const top = [bs[0], bs[1] - burger.cum - 10];
    await A.reach(top, 520, () => { A.release(tb); f = A.fly(tb, [top[0], top[1] + 10], 240, 28); });
    await f; A.remove(tb);
    burger.layers.push({ key: 'bun_top' });
    addNutri(def.ing.length + 1, top[0], top[1] - 14);
    A.puff(top[0], top[1], '#ffe9b8', 6, { speed: 30, life: 350 });
    await A.wait(250);

    // 4. 压一压、包装 -> 成品图标
    A.stage(nSt - 1);
    A.say('压实并包装');
    await A.reach([bs[0], bs[1] - burger.cum - 14], 600, () => {});
    await A.anim(380, (k) => { burger.squash = 1 - 0.1 * Math.sin(k * Math.PI); });
    burger.squash = 1;
    A.say('包装完成');
    const fin = A.spawn({ type: 'spr', key: def.sprite, x: bs[0], y: bs[1] + 4, w: 74, scale: 0.6, alpha: 0 });
    o.main = fin;
    await A.anim(360, (k) => { fin.alpha = k; fin.scale = 0.6 + 0.4 * EASE.back(k); burger.alpha = 1 - k; });
    A.remove(burger);
    A.puff(fin.x, fin.y - 30, '#fff3b0', 8, { speed: 55, life: 450, g: 0 });
    await A.wait(160);

    // 5. 端到出餐台
    A.pick(fin);
    await A.reach([fin.x, fin.y - 12], 360, () => { A.pick(fin); });
    o.where = 'hand';
    await A.deliver(fin, 56);
  };

  /* ------------------------- 饮料 ------------------------- */
  R.drink = async function (A, o, def) {
    const E = A.E, ds = MD.ST.drink.spot, nz = MD.NOZZLE;
    A.stage(0);
    A.say('拿杯子');
    await A.walk('drink');
    let cup;
    await A.reach([ds[0] + 70, ds[1] - 58], 480, () => {
      cup = A.spawn({ type: 'fill', key: def.sprite, x: ds[0] + 70, y: ds[1] - 56, w: 36, scale: 1, alpha: 1, level: 0 });
      A.pick(cup);
    });
    o.main = cup; o.where = 'drink';
    A.say('放到饮料机下');
    let f;
    await A.reach([ds[0], ds[1] - 12], 480, () => { A.release(cup); f = A.fly(cup, [ds[0], ds[1]], 260, 22); });
    await f;
    await A.wait(160);

    // 接饮料：出料口的液柱 + 杯里的液面上升
    const tot = o.totalNutri || (MD.itemNutrition ? MD.itemNutrition(def) : { kcal: 120, protein: 0, fat: 0, carb: 28 });
    A.stage(1);
    A.say(def.id === 'hot_coffee' ? '接热咖啡' : '接饮料');
    const col = def.color;
    const stream = A.fxAdd((c) => {
      const yTop = cup.y - 36 * cup.level - 8;
      c.fillStyle = col; c.fillRect(nz[0] - 2, nz[1], 4, Math.max(0, yTop - nz[1]));
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(nz[0] - 2, nz[1], 1, Math.max(0, yTop - nz[1]));
    });
    await A.anim(2300, (k) => {
      cup.level = k; cup.dx = Math.sin(k * 90) * 0.6;
      o.liveNutri = { kcal: Math.round(tot.kcal * k), protein: Math.round(tot.protein * k * 10) / 10, fat: Math.round(tot.fat * k * 10) / 10, carb: Math.round(tot.carb * k * 10) / 10, lastDelta: tot.kcal, lastLabel: def.name, stepSeq: 1 };
      if (Math.random() < 0.25) A.puff(cup.x, cup.y - 36 * k - 8, col, 1, { speed: 14, g: 120, life: 260, size: 2 });
    }, EASE.lin);
    cup.dx = 0;
    A.fxRm(stream);
    if (A.calPop) A.calPop(cup.x, cup.y - 48, `+${tot.kcal} kcal · ${def.name}`);
    A.puff(cup.x, cup.y - 40, col, 5, { speed: 20, life: 300, g: 60 });
    await A.wait(150);
    A.stage(2);
    A.say('盖盖子、插吸管');
    await A.pop(cup);
    await A.wait(180);
    A.puff(cup.x, cup.y - 52, '#ffffff', 4, { speed: 20, life: 300, g: 0 });
    if (def.steam) A.puff(cup.x, cup.y - 50, '#ffffff', 5, { speed: 10, up: -30, g: -20, life: 700 });

    // 取杯 -> 出餐
    A.stage(3);
    A.pick(cup);
    await A.reach([cup.x, cup.y - 18], 360, () => { A.pick(cup); });
    o.where = 'hand';
    await A.deliver(cup, 40);
  };

  /* ------------------------- 薯条 / 炸鸡 ------------------------- */
  R.fry = async function (A, o, def) {
    const E = A.E, bk = MD.BASKET[def.basket];
    const nSt = MD.stepsFor(def).labels.length;
    A.stage(0);
    A.say('拿包装');
    await A.walk('fryer');
    let box;
    await A.reach([E.worker.x - 30, E.worker.y - 30], 380, () => {
      box = A.spawn({ type: 'fill', key: def.food, x: E.worker.x, y: E.worker.y - 40, w: 38, scale: 1, alpha: 1, level: 0 });
      A.pick(box);
    });
    o.main = box; o.where = 'hand';
    // 提起炸篮沥油
    A.stage(1);
    A.say('提起炸篮，沥油');
    let lift = 0;
    const basketFx = A.fxAdd((c) => {
      c.fillStyle = '#3b3b3b'; c.fillRect(bk[0] - 4, bk[1] - 36 - lift, 8, 4);
    });
    await A.reach([bk[0], bk[1] - 14], 800, () => {});
    A.fxRm(basketFx);
    await A.anim(500, (k) => { lift = k * 14; });
    A.puff(bk[0], bk[1] - 10, '#fff', 6, { speed: 24, up: -30, g: -20, life: 600 });
    // 装盒：三铲
    const tot = o.totalNutri || (MD.itemNutrition ? MD.itemNutrition(def) : { kcal: 280, protein: 4, fat: 14, carb: 32 });
    const scoopKcal = Math.round(tot.kcal / 3);
    A.stage(2);
    A.say('铲起装盒');
    for (let i = 1; i <= 3; i++) {
      const t0 = [bk[0], bk[1] - 12];
      const p = A.spawn({ type: 'spr', key: def.basket === 1 ? 'fries_pack' : 'nugget', x: t0[0], y: t0[1], w: def.basket === 1 ? 20 : 16, scale: 1, alpha: 1, tiny: true });
      await A.reach([bk[0], bk[1] - 10], 260, () => {});
      const target = [box.x, box.y - 14];
      await A.fly(p, target, 260, 26);
      A.remove(p);
      box.level = i / 3;
      const curKcal = i === 3 ? tot.kcal : scoopKcal * i;
      o.liveNutri = { kcal: curKcal, protein: Math.round(tot.protein * (i / 3) * 10) / 10, fat: Math.round(tot.fat * (i / 3) * 10) / 10, carb: Math.round(tot.carb * (i / 3) * 10) / 10, lastDelta: i === 3 ? tot.kcal - scoopKcal * 2 : scoopKcal, lastLabel: `第${i}铲`, stepSeq: i };
      if (A.calPop) A.calPop(box.x, box.y - 28, `+${o.liveNutri.lastDelta} kcal`);
      E.emit();
      A.puff(box.x, box.y - 20, '#ffd45e', 3, { speed: 24, life: 260 });
    }
    // 撒盐
    if (def.salt) {
      A.stage(3);
      A.say('撒盐');
      await A.walk('fryer');
      const sx = box.x, sy = box.y - 48;
      for (let i = 0; i < 6; i++) { A.puff(sx + (Math.random() - 0.5) * 18, sy, '#ffffff', 2, { speed: 14, g: 220, life: 380, size: 2 }); await A.wait(70); }
      await A.anim(320, (k) => { box.dx = Math.sin(k * 14) * 2; });
      box.dx = 0;
    }
    A.stage(nSt - 1);
    await A.pop(box);
    await A.deliver(box, 52);
  };

  /* ------------------------- 冰淇淋 / 圣代 / 麦旋风 ------------------------- */
  R.soft = async function (A, o, def) {
    const E = A.E, is = MD.ST.ice.spot, W = def.style === 'cone' ? 30 : 34;
    const nSt = MD.stepsFor(def).labels.length;
    A.stage(0);
    A.say(def.style === 'cone' ? '拿甜筒' : '拿杯子');
    await A.walk('ice');
    let cup;
    await A.reach([is[0] + 34, is[1] - 30], 460, () => {
      cup = A.spawn({ type: 'fill', key: def.sprite, x: is[0] + 34, y: is[1] - 26, w: W, scale: 1, alpha: 1, level: 0 });
      A.pick(cup);
    });
    o.main = cup; o.where = 'ice';
    A.say('放到冰淇淋机下');
    let f;
    await A.reach([is[0], is[1] - 10], 460, () => { A.release(cup); f = A.fly(cup, [is[0], is[1]], 240, 20); });
    await f;
    const tot = o.totalNutri || (MD.itemNutrition ? MD.itemNutrition(def) : { kcal: 220, protein: 4, fat: 7, carb: 34 });
    A.stage(1);
    A.say('挤冰淇淋');
    const nz = [is[0], is[1] - 62];
    const stream = A.fxAdd((c) => {
      c.fillStyle = '#fffdf2'; c.fillRect(nz[0] - 3, nz[1], 6, Math.max(0, cup.y - 40 * cup.level - nz[1]));
    });
    await A.anim(2000, (k) => {
      cup.level = k; cup.dx = Math.sin(k * 60) * 0.5;
      o.liveNutri = { kcal: Math.round(tot.kcal * k), protein: Math.round(tot.protein * k * 10) / 10, fat: Math.round(tot.fat * k * 10) / 10, carb: Math.round(tot.carb * k * 10) / 10, lastDelta: tot.kcal, lastLabel: def.name, stepSeq: 1 };
    }, EASE.lin);
    cup.dx = 0;
    A.fxRm(stream);
    if (A.calPop) A.calPop(cup.x, cup.y - 44, `+${tot.kcal} kcal · ${def.name}`);
    if (def.style === 'flurry') {
      A.stage(2);
      A.say('搅拌麦旋风');
      await A.anim(900, (k) => { cup.dx = Math.sin(k * 30) * 2; cup.rot = Math.sin(k * 12) * 0.08; });
      cup.dx = 0; cup.rot = 0;
    } else if (def.style === 'sundae') {
      A.stage(2);
      A.say('淋巧克力酱');
      const sauce = A.fxAdd((c) => { c.fillStyle = '#3b1b0f'; c.fillRect(cup.x - 1, cup.y - 56, 3, 14); });
      await A.anim(500, () => {});
      A.fxRm(sauce);
    }
    A.stage(nSt - 1);
    await A.pop(cup);
    A.pick(cup);
    await A.reach([cup.x, cup.y - 18], 360, () => { A.pick(cup); });
    o.where = 'hand';
    await A.deliver(cup, 40);
  };
})(typeof window !== 'undefined' ? window : globalThis);
