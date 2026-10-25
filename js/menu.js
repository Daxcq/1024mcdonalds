/* 数据层 2/2：菜单、分类、套餐。kind 决定制作流程（见 recipes.js） */
(function (g) {
  const MD = g.MD;
  MD.CATS = [
    { id: 'burger', name: '汉堡', icon: 'burger' },
    { id: 'fries', name: '薯条', icon: 'fries_m' },
    { id: 'chicken', name: '炸鸡', icon: 'fried_chicken' },
    { id: 'drink', name: '饮料', icon: 'cola' },
    { id: 'dessert', name: '甜品', icon: 'cone' },
    { id: 'combo', name: '套餐', icon: 'bigmac' },
  ];
  MD.P = {};
  MD.LIST = [];
  const add = (id, name, cat, price, kind, o) => {
    const d = Object.assign({ id, name, cat, price, kind, sprite: id }, o || {});
    MD.P[id] = d; MD.LIST.push(d);
  };
  // 汉堡：ing = 下层面包与上层面包之间的配料（mid=中层面包，巨无霸用）
  add('burger', '汉堡', 'burger', 12, 'burger', { ing: ['beef', 'pickle', 'ketchup', 'onion'] });
  add('cheeseburger', '芝士汉堡', 'burger', 14, 'burger', { ing: ['beef', 'cheese', 'pickle', 'ketchup'] });
  add('double_cheese', '双层芝士汉堡', 'burger', 20, 'burger', { ing: ['beef', 'cheese', 'beef', 'cheese', 'pickle'] });
  add('mcchicken', '麦香鸡', 'burger', 15, 'burger', { ing: ['chicken', 'lettuce', 'mayo'] });
  add('spicy_mcchicken', '辣味麦香鸡', 'burger', 16, 'burger', { ing: ['chicken', 'lettuce', 'ketchup'] });
  add('bigmac', '巨无霸', 'burger', 22, 'burger', { ing: ['beef', 'lettuce', 'cheese', 'mid', 'beef', 'lettuce', 'pickle'] });
  add('spicy_leg', '麦辣鸡腿堡', 'burger', 20, 'burger', { ing: ['chicken', 'lettuce', 'tomato', 'ketchup'] });
  add('crispy_chicken', '脆皮炸鸡堡', 'burger', 18, 'burger', { ing: ['chicken', 'lettuce', 'mayo'] });
  add('teriyaki', '照烧鸡腿堡', 'burger', 19, 'burger', { ing: ['chicken', 'onion', 'lettuce', 'ketchup'] });
  // 薯条 / 炸鸡：从炸锅出，basket 1=薯条篮 2=鸡块篮
  add('fries_s', '薯条（小）', 'fries', 8, 'fry', { basket: 1, food: 'fries_pack', salt: true });
  add('fries_m', '薯条（中）', 'fries', 11, 'fry', { basket: 1, food: 'fries_pack', salt: true });
  add('fries_l', '薯条（大）', 'fries', 14, 'fry', { basket: 1, food: 'fries_pack', salt: true });
  add('nuggets5', '麦乐鸡（5块）', 'chicken', 12, 'fry', { basket: 2, food: 'nuggets_pile5' });
  add('nuggets10', '麦乐鸡（10块）', 'chicken', 22, 'fry', { basket: 2, food: 'nuggets_pile10' });
  add('fried_chicken', '原味鸡', 'chicken', 11, 'fry', { basket: 2, food: 'drumstick' });
  add('spicy_wings', '辣味鸡翅', 'chicken', 13, 'fry', { basket: 2, food: 'wings2' });
  add('wings2', '鸡翅（2块）', 'chicken', 10, 'fry', { basket: 2, food: 'wings2' });
  add('apple_pie', '苹果派', 'chicken', 7, 'fry', { basket: 2, food: 'apple_pie' });
  // 饮料：color 是饮料颜色
  add('cola', '可乐', 'drink', 8, 'drink', { color: '#4a2016' });
  add('orange', '橙汁', 'drink', 9, 'drink', { color: '#ffae17' });
  add('iced_coffee', '冰咖啡', 'drink', 12, 'drink', { color: '#a9784b', ice: true });
  add('hot_coffee', '热咖啡', 'drink', 10, 'drink', { color: '#2b1608', steam: true });
  // 甜品：style = cone 甜筒 / cup 杯装
  add('cone', '圆筒冰淇淋', 'dessert', 6, 'soft', { style: 'cone' });
  add('sundae', '圣代', 'dessert', 9, 'soft', { style: 'sundae' });
  add('mcflurry', '麦旋风', 'dessert', 14, 'soft', { style: 'flurry' });

  // 套餐：加入时拆成多个单品，各自独立制作、独立取消
  MD.COMBOS = [
    { id: 'combo_bigmac', name: '巨无霸套餐', price: 32, sprite: 'bigmac', items: ['bigmac', 'fries_m', 'cola'] },
    { id: 'combo_mcchicken', name: '麦香鸡套餐', price: 28, sprite: 'mcchicken', items: ['mcchicken', 'fries_s', 'orange'] },
    { id: 'combo_nuggets', name: '麦乐鸡分享', price: 38, sprite: 'nuggets10', items: ['nuggets10', 'fries_l', 'cola'] },
    { id: 'combo_two', name: '双人餐', price: 55, sprite: 'cheeseburger', items: ['cheeseburger', 'spicy_leg', 'fries_l', 'cola', 'orange'] },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
