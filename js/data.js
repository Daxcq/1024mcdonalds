/* 数据层 1/2：站点坐标、汉堡配料。坐标全部是 assets/kitchen_bg.png (868x1049) 的像素坐标。 */
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
    beef:    { st: 'grill',  key: 'patty_beef',    take: '从煎台取牛肉饼', put: '放上牛肉饼' },
    chicken: { st: 'fryer',  key: 'patty_chicken', take: '从炸锅取鸡排',   put: '放上鸡排' },
    cheese:  { st: 'cheese', key: 'cheese',        take: '取芝士片',       put: '盖上芝士' },
    lettuce: { st: 'veg',    key: 'lettuce',       take: '取生菜',         put: '铺上生菜' },
    tomato:  { st: 'veg',    key: 'tomato',        take: '取番茄片',       put: '放上番茄' },
    pickle:  { st: 'veg',    key: 'pickle',        take: '取酸黄瓜',       put: '放上酸黄瓜' },
    onion:   { st: 'veg',    key: 'onion',         take: '取洋葱',         put: '放上洋葱' },
    ketchup: { st: 'sauce',  key: 'sauce_ketchup', take: '拿起番茄酱',     put: '挤上番茄酱' },
    mayo:    { st: 'sauce',  key: 'sauce_mayo',    take: '拿起蛋黄酱',     put: '挤上蛋黄酱' },
    mid:     { st: 'bun',    key: 'bun_bottom',    take: '取中层面包',     put: '放上中层面包' },
  };
  // 汉堡每层绘制宽度(w)和叠高(dy)；band 表示用色条画酱料
  MD.LAYER = {
    bun_bottom: { w: 74, dy: 14 }, patty_beef: { w: 64, dy: 11 }, patty_chicken: { w: 64, dy: 11 },
    cheese: { w: 68, dy: 6 }, lettuce: { w: 78, dy: 10 }, tomato: { w: 60, dy: 8 },
    pickle: { w: 50, dy: 6 }, onion: { w: 50, dy: 6 },
    sauce_ketchup: { w: 56, dy: 4, band: '#d3281c' }, sauce_mayo: { w: 56, dy: 4, band: '#fff1cc' },
    bun_top: { w: 76, dy: 0 },
  };
})(typeof window !== 'undefined' ? window : globalThis);
