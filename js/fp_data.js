/* 汉堡小游戏 · 数据层：52 种配料 + 20 个配方 + 评分/命名规则。
 * 纯数据与纯函数，浏览器和 node 都能跑（tools/fp_data_test.js 用）。 */
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const FP = (G.FP = G.FP || {});

  FP.CATS = [
    { id: 'bun', name: '面包', icon: 'I02' },
    { id: 'patty', name: '肉饼', icon: 'I13' },
    { id: 'egg', name: '蛋 · 芝士', icon: 'I22' },
    { id: 'veg', name: '蔬果', icon: 'I30' },
    { id: 'sauce', name: '酱料', icon: 'I40' },
    { id: 'spice', name: '调味', icon: 'I50' },
  ];

  /* id, 名称, 分类, 角色, 叠放宽度(px), 叠放增高(px), 价格, 热量, 标签 */
  const SPEC = [
    ['I01', '芝麻面包上胚', 'bun', 'bunTop', 330, 64, 1.5, 120, 'bun sesame'],
    ['I02', '芝麻面包下胚', 'bun', 'bunBottom', 320, 46, 1.5, 110, 'bun sesame'],
    ['I03', '巨无霸中层面包', 'bun', 'bunMid', 315, 40, 1.5, 105, 'bun'],
    ['I04', '无芝麻面包上胚', 'bun', 'bunTop', 330, 62, 1.5, 118, 'bun'],
    ['I05', '无芝麻面包下胚', 'bun', 'bunBottom', 320, 44, 1.5, 108, 'bun'],
    ['I06', '长形芝麻面包上胚', 'bun', 'bunTop', 340, 52, 1.8, 125, 'bun sesame'],
    ['I07', '长形面包下胚', 'bun', 'bunBottom', 330, 36, 1.8, 112, 'bun'],
    ['I08', '布里欧修面包上胚', 'bun', 'bunTop', 330, 66, 2, 130, 'bun'],
    ['I09', '布里欧修面包下胚', 'bun', 'bunBottom', 320, 46, 2, 118, 'bun'],
    ['I10', '麦满分英式松饼上胚', 'bun', 'bunTop', 320, 48, 1.8, 115, 'bun'],
    ['I11', '麦满分英式松饼下胚', 'bun', 'bunBottom', 320, 42, 1.8, 110, 'bun'],
    ['I12', '薄牛肉饼', 'patty', 'layer', 300, 32, 3, 130, 'beef protein'],
    ['I13', '厚牛肉饼', 'patty', 'layer', 310, 42, 4, 190, 'beef protein'],
    ['I14', '麦香鸡圆鸡排', 'patty', 'layer', 320, 44, 3.5, 170, 'chicken protein'],
    ['I15', '麦辣风格脆鸡腿排', 'patty', 'layer', 330, 46, 4, 200, 'chicken spicy protein'],
    ['I16', '板烧风格鸡腿排', 'patty', 'layer', 325, 42, 4, 185, 'chicken grilled protein'],
    ['I17', '方形炸鱼排', 'patty', 'layer', 290, 38, 4, 160, 'fish protein'],
    ['I18', '香脆鲜虾排', 'patty', 'layer', 300, 40, 4.5, 165, 'shrimp protein'],
    ['I19', '培根片', 'patty', 'layer', 300, 26, 2.5, 90, 'pork bacon protein'],
    ['I20', '猪柳肉饼', 'patty', 'layer', 300, 38, 3.5, 175, 'pork protein'],
    ['I21', '火腿片', 'patty', 'layer', 295, 26, 2, 60, 'pork ham protein'],
    ['I22', '太阳煎蛋', 'egg', 'layer', 300, 34, 2, 85, 'egg protein'],
    ['I23', '圆形煎蛋', 'egg', 'layer', 290, 32, 2, 80, 'egg protein'],
    ['I24', '黄色切达芝士片', 'egg', 'layer', 320, 20, 1.5, 70, 'cheese'],
    ['I25', '白色芝士片', 'egg', 'layer', 320, 20, 1.5, 65, 'cheese'],
    ['I26', '融化芝士层', 'egg', 'layer', 330, 22, 2, 85, 'cheese'],
    ['I27', '黄油块', 'egg', 'layer', 150, 22, 1, 55, 'butter'],
    ['I28', '完整生菜叶', 'veg', 'layer', 340, 34, 1, 12, 'veg lettuce'],
    ['I29', '生菜丝', 'veg', 'layer', 310, 28, 1, 10, 'veg lettuce'],
    ['I30', '番茄片', 'veg', 'layer', 290, 30, 1.2, 18, 'veg tomato'],
    ['I31', '酸黄瓜片', 'veg', 'layer', 250, 28, 0.8, 8, 'veg pickle'],
    ['I32', '白洋葱圈', 'veg', 'layer', 260, 28, 0.8, 10, 'veg onion'],
    ['I33', '洋葱碎', 'veg', 'layer', 260, 22, 0.8, 9, 'veg onion'],
    ['I34', '焦糖洋葱丝', 'veg', 'layer', 260, 24, 1.2, 25, 'veg onion sweet'],
    ['I35', '鲜黄瓜片', 'veg', 'layer', 250, 28, 0.8, 6, 'veg cucumber'],
    ['I36', '墨西哥辣椒圈', 'veg', 'layer', 230, 26, 0.8, 5, 'veg jalapeno spicy'],
    ['I37', '菠萝圈', 'veg', 'layer', 270, 32, 1.5, 40, 'veg pineapple sweet'],
    ['I38', '炒蘑菇片', 'veg', 'layer', 270, 30, 1.5, 30, 'veg mushroom'],
    ['I39', '紫洋葱圈', 'veg', 'layer', 260, 28, 0.8, 10, 'veg onion'],
    ['I40', '番茄酱', 'sauce', 'sauce', 170, 20, 0.5, 20, 'sauce ketchup sweet'],
    ['I41', '黄芥末酱', 'sauce', 'sauce', 170, 20, 0.5, 15, 'sauce mustard'],
    ['I42', '蛋黄酱', 'sauce', 'sauce', 170, 20, 0.5, 45, 'sauce mayo'],
    ['I43', '橙色特调汉堡酱', 'sauce', 'sauce', 170, 20, 0.8, 40, 'sauce special sweet'],
    ['I44', '香辣蛋黄酱', 'sauce', 'sauce', 170, 20, 0.8, 45, 'sauce mayo spicy'],
    ['I45', '塔塔酱', 'sauce', 'sauce', 170, 20, 0.8, 35, 'sauce tartar'],
    ['I46', '烧烤酱', 'sauce', 'sauce', 170, 20, 0.8, 30, 'sauce bbq sweet'],
    ['I47', '甜辣酱', 'sauce', 'sauce', 170, 20, 0.8, 35, 'sauce sweet spicy'],
    ['I48', '蜂蜜芥末酱', 'sauce', 'sauce', 170, 20, 0.8, 40, 'sauce mustard sweet'],
    ['I49', '芝士酱', 'sauce', 'sauce', 170, 20, 1, 50, 'sauce cheese'],
    ['I50', '白芝麻', 'spice', 'sprinkle', 240, 6, 0.3, 8, 'spice sesame'],
    ['I51', '食盐', 'spice', 'sprinkle', 240, 6, 0.2, 0, 'spice salt'],
    ['I52', '黑胡椒碎', 'spice', 'sprinkle', 250, 6, 0.3, 3, 'spice pepper'],
  ];

  FP.ING = {};
  FP.ING_LIST = SPEC.map((r) => {
    const it = { id: r[0], name: r[1], cat: r[2], role: r[3], w: r[4], rise: r[5], price: r[6], kcal: r[7], tags: r[8].split(' ') };
    FP.ING[it.id] = it;
    return it;
  });
  FP.ingByCat = (cat) => FP.ING_LIST.filter((i) => i.cat === cat);
  FP.ing = (id) => FP.ING[id];
  FP.isBun = (id) => ['bunTop', 'bunBottom', 'bunMid'].includes(FP.ING[id].role);
})();
