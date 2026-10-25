/* 后端接入层: 门店 -> 真实菜单 -> 结算。
 * 原则:
 *  - 对 engine.js / recipes.js / render.js 零改动; 只替换 MD.P / MD.LIST (商品表), 动画流程不变。
 *  - 价格以后端为准。前端只传 (商品 id, 数量), 不传价格。
 *  - 后端不可达时保持 js/menu.js 自带的离线菜单, 页面仍可当演示用, 并明确标注"离线演示"。
 */
(function (g) {
  const MD = g.MD;
  const API = (MD.API = { online: false, sid: null, store: null, demo: true, pending: null });

  async function call(path, body) {
    const r = await fetch(path, body === undefined ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : '请求失败(' + r.status + ')');
    return j;
  }
  API.call = call;

  /* 把后端商品替换进商品表。引擎只按 MD.P[id] 取定义, 所以这里换数据即可。 */
  API.useMenu = function (items) {
    MD.P = {}; MD.LIST = [];
    for (const it of items) {
      const d = Object.assign({}, it, { sprite: it.sprite });
      MD.P[d.id] = d; MD.LIST.push(d);
    }
    MD.COMBOS = [];   // 套餐需拆成单品并由后端结算优惠, 本版不提供
    MD.CATS = MD.CATS.filter((c) => c.id !== 'combo');
    API.menuReady = true;
  };

  API.stores = () => call('/api/city/stores');

  API.chooseStore = async function (store) {
    await call('/api/store', { session_id: API.sid, store_code: store.storeCode });
    const m = await call('/api/kitchen/menu?session_id=' + encodeURIComponent(API.sid));
    API.useMenu(m.items);
    API.store = store; API.pending = null;
    return m;
  };

  /* 用当前未取消的订单去后端算价。返回待确认订单, 价格单位: 元。 */
  API.checkout = async function (orders) {
    const count = {};
    orders.forEach((o) => { count[o.pid] = (count[o.pid] || 0) + 1; });
    const items = Object.keys(count).map((id) => ({ id, quantity: count[id] }));
    const r = await call('/api/kitchen/checkout', { session_id: API.sid, items });
    API.pending = r.state.pending;
    return API.pending;
  };

  API.init = async function () {
    try {
      const [s, c] = await Promise.all([call('/api/session', {}), call('/api/config')]);
      API.sid = s.session_id; API.demo = c.demo; API.online = true;
    } catch (e) { API.online = false; }
    return API;
  };
})(typeof window !== 'undefined' ? window : globalThis);
