/* 后端接入层: 门店 -> 真实菜单 -> 结算。
 * 原则:
 *  - 对 engine.js / recipes.js / render.js 零改动; 只替换 MD.P / MD.LIST (商品表), 动画流程不变。
 *  - 价格以后端为准。前端只传 (商品 id, 数量), 不传价格。
 *  - 后端不可达时保持 js/menu.js 自带的离线菜单, 页面仍可当演示用, 并明确标注"离线演示"。
 */
(function (g) {
  const MD = g.MD;
  const API = (MD.API = { online: false, sid: null, store: null, demo: true, pending: null });

  async function raw(path, body) {
    const r = await fetch(path, body === undefined ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  }
  function fail(r, j) { throw Object.assign(new Error(typeof j.detail === 'string' ? j.detail : '请求失败(' + r.status + ')'), { status: r.status }); }

  async function call(path, body) {
    const { r, j } = await raw(path, body);
    if (!r.ok) fail(r, j);
    return j;
  }
  API.call = call;

  /* 会话在服务端有过期时间(默认 2 小时)，服务重启后也会丢。遇到 404 就重建会话、
   * 重新选好原来的门店，把请求里的 session_id 换成新的再重试一次；仍失败就抛给界面。
   * 只重试一次，避免服务端持续异常时死循环。 */
  async function callWithSession(path, makeBody) {
    const url = (p) => p.replace(/session_id=[^&]*/, 'session_id=' + encodeURIComponent(API.sid));
    let { r, j } = await raw(url(path), makeBody ? makeBody() : undefined);
    if (r.status === 404 && API.sid) {
      const s = await call('/api/session', {});
      API.sid = s.session_id;
      try { sessionStorage.setItem('mcd.kitchenSession', API.sid); } catch (e) {}
      if (API.store) await call('/api/store', { session_id: API.sid, store_code: API.store.storeCode });
      API.expired = true;                                    // 让界面知道购物车被重置过
      ({ r, j } = await raw(url(path), makeBody ? makeBody() : undefined));
    }
    if (!r.ok) fail(r, j);
    return j;
  }

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

  /* 记住玩家上次手动选的店(只存门店编号)。浏览器禁用存储时静默忽略，不影响使用。 */
  const KEY = 'mcd.lastStore';
  API.remember = (code) => { try { localStorage.setItem(KEY, code); } catch (e) {} };
  API.recall = () => { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } };

  /* 自动选店：后端按"上次选的店 > 此刻营业的店 > 其余"依次尝试，取到菜单即停。
   * 成功：换上真实菜单并返回店信息。失败（都打烊 / MCP 不可用）：抛错，页面保持离线演示菜单。 */
  API.autoStore = async function () {
    const r = await callWithSession('/api/kitchen/auto-store',
      () => ({ session_id: API.sid, preferred: API.recall() }));
    API.useMenu(r.items);
    API.store = r.store; API.pending = null;
    return r;
  };

  API.chooseStore = async function (store) {
    // 选店是"开新局"。会话过期（404）就重建一次再选；这里直接用选店请求本身来探测，
    // 不依赖任何额外的"查询会话"接口（避免该接口不存在时把正常会话误判为过期）。
    let res = await raw('/api/store', { session_id: API.sid, store_code: store.storeCode });
    if (res.r.status === 404 && /过期|不存在/.test(String(res.j.detail || ''))) {
      API.sid = (await call('/api/session', {})).session_id; API.expired = true;
      try { sessionStorage.setItem('mcd.kitchenSession', API.sid); } catch (e) {}
      res = await raw('/api/store', { session_id: API.sid, store_code: store.storeCode });
    }
    if (!res.r.ok) fail(res.r, res.j);
    const m = await call('/api/kitchen/menu?session_id=' + encodeURIComponent(API.sid));
    API.useMenu(m.items);
    API.store = store; API.pending = null;
    API.remember(store.storeCode);          // 只有玩家手动选的店才记住；自动选的不记，避免"打烊的店"变成默认
    return m;
  };

  /* 用当前未取消的订单去后端算价。返回待确认订单, 价格单位: 元。
   * 会话过期时自动重建并重新选店；订单本身由前端传入，所以重建后不会丢。 */
  API.checkout = async function (orders) {
    const count = {};
    orders.forEach((o) => { count[o.pid] = (count[o.pid] || 0) + 1; });
    const items = Object.keys(count).map((id) => ({ id, quantity: count[id] }));
    const r = await callWithSession('/api/kitchen/checkout',
      () => ({ session_id: API.sid, items }));
    API.pending = r.state.pending;
    return API.pending;
  };

  API.init = async function () {
    try {
      let saved = null;
      try { saved = sessionStorage.getItem('mcd.kitchenSession'); } catch (e) {}
      const [s, c] = await Promise.all([call('/api/session', { session_id: saved }), call('/api/config')]);
      try { sessionStorage.setItem('mcd.kitchenSession', s.session_id); } catch (e) {}
      API.sid = s.session_id; API.demo = c.demo; API.online = true;
    } catch (e) { API.online = false; }
    return API;
  };
})(typeof window !== 'undefined' ? window : globalThis);
