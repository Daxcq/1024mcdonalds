/* 数据层 1/2：站点坐标、汉堡配料与每层营养指标。坐标全部是 assets/kitchen_bg.png (868x1049) 的像素坐标。 */
(function (g) {
  const MD = (g.MD = g.MD || {});
  MD.W = 868; MD.H = 1049;
  MD.WS = 1.0;       // 店员缩放：1.0 = 和背景图里的小人同大（154x200）
  MD.WALK = 330;     // 走路速度 px/s

  // stand = 店员脚底站位；spot = 食物放置位置（底部中心）；src = 取料时素材飞出的位置
  MD.ST = {
    home:  { stand: [474, 648] },
    drink: { stand: [262, 532], spot: [140, 438] },
    ice:   { stand: [410, 500], spot: [412, 440] },
    grill: { stand: [600, 490], src: [575, 268] },
    fryer: { stand: [654, 598], src: [790, 462] },
    bun:   { stand: [250, 584], src: [215, 668] },
    veg:   { stand: [330, 608], src: [300, 712] },
    cheese:{ stand: [412, 650], src: [420, 742] },
    sauce: { stand: [520, 712], src: [572, 790] },
    board: { stand: [472, 706], spot: [484, 868] },
    pass:  { stand: [690, 774] },
    trash: { stand: [792, 706], spot: [856, 668] },
  };
  MD.NOZZLE = [140, 376];                 // 饮料机出料口
  MD.BASKET = { 1: [790, 462], 2: [862, 522] }; // 炸篮位置：1=薯条 2=鸡块/鸡肉

  // 出餐台格子（等距方向），满了向上叠，向左向上偏移避免和红色打包盒重叠
  MD.PASS = { o: [592, 838], u: [40, 20], v: [22, -11], cols: 4, rows: 3 };
  MD.slotPos = (i) => {
    const P = MD.PASS, n = P.cols * P.rows, layer = Math.floor(i / n), j = i % n;
    const c = j % P.cols, r = Math.floor(j / P.cols);
    return [P.o[0] + P.u[0] * c + P.v[0] * r, P.o[1] + P.u[1] * c + P.v[1] * r - layer * 18];
  };

  // 汉堡配料：st=取料站点，key=素材，take/put=动作文案
  MD.ING = {
    beef:    { st: 'grill',  key: 'patty_beef',    take: '从煎台取牛肉饼', put: '放上牛肉饼', label: '牛肉饼' },
    chicken: { st: 'fryer',  key: 'patty_chicken', take: '从炸锅取鸡排',   put: '放上鸡排',   label: '香脆鸡排' },
    cheese:  { st: 'cheese', key: 'cheese',        take: '取芝士片',       put: '盖上芝士',   label: '芝士片' },
    lettuce: { st: 'veg',    key: 'lettuce',       take: '取生菜',         put: '铺上生菜',   label: '生菜' },
    tomato:  { st: 'veg',    key: 'tomato',        take: '取番茄片',       put: '放上番茄',   label: '番茄片' },
    pickle:  { st: 'veg',    key: 'pickle',        take: '取酸黄瓜',       put: '放上酸黄瓜', label: '酸黄瓜' },
    onion:   { st: 'veg',    key: 'onion',         take: '取洋葱',         put: '放上洋葱',   label: '洋葱粒' },
    ketchup: { st: 'sauce',  key: 'sauce_ketchup', take: '拿起番茄酱',     put: '挤上番茄酱', label: '番茄酱' },
    mayo:    { st: 'sauce',  key: 'sauce_mayo',    take: '拿起蛋黄酱',     put: '挤上蛋黄酱', label: '特调酱汁' },
    mid:     { st: 'bun',    key: 'bun_bottom',    take: '取中层面包',     put: '放上中层面包', label: '中层面包' },
  };
  // 汉堡每层绘制宽度(w)、叠高(dy)与单层营养数据(kcal / protein / fat / carb)；band 表示用色条画酱料
  MD.LAYER = {
    bun_bottom:    { w: 74, dy: 14, kcal: 75,  protein: 2.5,  fat: 1.0, carb: 14.0, label: '下层面包' },
    patty_beef:    { w: 64, dy: 11, kcal: 130, protein: 11.0, fat: 9.5, carb: 0.5,  label: '牛肉饼' },
    patty_chicken: { w: 64, dy: 11, kcal: 165, protein: 12.5, fat: 9.5, carb: 7.0,  label: '香脆鸡排' },
    cheese:        { w: 68, dy: 6,  kcal: 50,  protein: 3.0,  fat: 4.0, carb: 0.5,  label: '芝士片' },
    lettuce:       { w: 78, dy: 10, kcal: 5,   protein: 0.3,  fat: 0.0, carb: 1.0,  label: '生菜' },
    tomato:        { w: 60, dy: 8,  kcal: 6,   protein: 0.3,  fat: 0.0, carb: 1.3,  label: '番茄片' },
    pickle:        { w: 50, dy: 6,  kcal: 4,   protein: 0.1,  fat: 0.0, carb: 0.8,  label: '酸黄瓜' },
    onion:         { w: 50, dy: 6,  kcal: 6,   protein: 0.2,  fat: 0.0, carb: 1.4,  label: '洋葱粒' },
    sauce_ketchup: { w: 56, dy: 4,  band: '#d3281c', kcal: 20, protein: 0.2, fat: 0.0, carb: 4.8, label: '番茄酱' },
    sauce_mayo:    { w: 56, dy: 4,  band: '#fff1cc', kcal: 75, protein: 0.2, fat: 8.0, carb: 1.2, label: '风味酱' },
    bun_top:       { w: 76, dy: 0,  kcal: 85,  protein: 2.8,  fat: 1.5, carb: 15.5, label: '上层面包' },
  };

  // 根据热量值返回等级样式与文案
  MD.calorieLevel = function (kcal) {
    if (kcal < 220) return { level: 'light', label: '轻盈低负担' };
    if (kcal < 420) return { level: 'light', label: '轻盈均衡' };
    if (kcal < 510) return { level: 'balanced', label: '均衡能量' };
    if (kcal < 550) return { level: 'hearty', label: '扎实满足' };
    return { level: 'indulgent', label: '热量炸弹' };
  };

  // 计算汉堡每一层的营养明细（保证各层累加之和等于总热量）
  MD.burgerLayersNutri = function (def) {
    if (!def || def.kind !== 'burger') return [];
    const L = MD.LAYER;
    const raw = [{ key: 'bun_bottom', label: '下层面包', ...L.bun_bottom }];
    for (const ing of (def.ing || [])) {
      const I = MD.ING[ing] || { key: 'cheese', label: ing };
      const d = L[I.key] || L.cheese;
      raw.push({ key: I.key, ing, label: I.label || d.label || ing, kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb });
    }
    raw.push({ key: 'bun_top', label: '上层面包', ...L.bun_top });
    const sumKcal = raw.reduce((s, x) => s + x.kcal, 0);
    // 若后端或菜单指定了精确总热量 def.kcal，将差值平滑分配到主料肉排层，使分层累加最终精确等于总热量
    if (def.kcal && def.kcal > 0 && def.kcal !== sumKcal) {
      const diff = def.kcal - sumKcal;
      const patty = raw.find((x) => x.key === 'patty_beef' || x.key === 'patty_chicken') || raw[raw.length - 1];
      patty.kcal = Math.max(10, patty.kcal + diff);
      if (diff > 0) {
        patty.protein = Math.round((patty.protein + diff * 0.045) * 10) / 10;
        patty.fat = Math.round((patty.fat + diff * 0.055) * 10) / 10;
      }
    }
    return raw;
  };

  // 获取任意单品的总营养指标（汉堡按层累加，小食/饮品/甜品按预设或估算）
  MD.itemNutrition = function (def) {
    if (!def) return { kcal: 0, protein: 0, fat: 0, carb: 0, level: 'light', label: '轻盈低负担' };
    if (def.kind === 'burger') {
      const layers = MD.burgerLayersNutri(def);
      const kcal = layers.reduce((s, x) => s + x.kcal, 0);
      const protein = Math.round(layers.reduce((s, x) => s + x.protein, 0) * 10) / 10;
      const fat = Math.round(layers.reduce((s, x) => s + x.fat, 0) * 10) / 10;
      const carb = Math.round(layers.reduce((s, x) => s + x.carb, 0) * 10) / 10;
      return Object.assign({ kcal, protein, fat, carb }, MD.calorieLevel(kcal));
    }
    const kcal = def.kcal != null ? def.kcal : (def.kind === 'fry' ? 280 : def.kind === 'soft' ? 240 : 120);
    const protein = def.protein != null ? def.protein : (def.cat === 'chicken' ? 15.0 : def.kind === 'fry' ? 3.8 : def.kind === 'soft' ? 4.2 : 0.5);
    const fat = def.fat != null ? def.fat : (def.kind === 'fry' ? 15.0 : def.kind === 'soft' ? 7.5 : 0.2);
    const carb = def.carb != null ? def.carb : (def.kind === 'fry' ? 32.0 : def.kind === 'soft' ? 36.0 : Math.round(kcal * 0.24 * 10) / 10);
    return Object.assign({ kcal, protein, fat, carb }, MD.calorieLevel(kcal));
  };
})(typeof window !== 'undefined' ? window : globalThis);
