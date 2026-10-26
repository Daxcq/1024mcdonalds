/* 右侧点餐界面 + 主循环 */
(function () {
  const MD = window.MD, $ = (s) => document.querySelector(s);
  const png = (k) => 'assets/sprites/' + k + '.png';
  let cat = 'burger', E = null, orderPanel = null;
  const toast = (t) => { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => e.classList.remove('show'), 1600); };

  function itemKcal(p) {
    if (!p) return 0;
    if (typeof p.kcal === 'number') return p.kcal;
    return MD.itemNutrition ? MD.itemNutrition(p).kcal : 0;
  }

  function renderCats() {
    $('#cats').innerHTML = MD.CATS.map((c) => `<button class="cat ${c.id === cat ? 'on' : ''}" data-c="${c.id}"><img src="${png(c.icon)}" alt=""><span>${c.name}</span></button>`).join('');
  }
  function renderGrid() {
    let h = '';
    if (cat === 'combo') {
      h = MD.COMBOS.map((c) => {
        const kcal = c.items.reduce((s, i) => s + itemKcal(MD.P[i]), 0);
        return `<div class="card" data-combo="${c.id}"><span class="combo">套餐</span><span class="plus">+</span><img src="${png(c.sprite)}" alt=""><div class="n">${c.name}</div><div class="sub">${c.items.map((i) => MD.P[i].name).join(' + ')}</div><div class="kcal">🔥 ${kcal} kcal</div><div class="p">${c.price}</div></div>`;
      }).join('');
    } else {
      h = MD.LIST.filter((p) => p.cat === cat).map((p) => {
        const kcal = itemKcal(p);
        return `<div class="card" data-p="${p.id}"><span class="plus">+</span><img src="${png(p.sprite)}" alt=""><div class="n">${p.name}</div><div class="kcal">🔥 ${kcal} kcal</div><div class="p">${p.price}</div></div>`;
      }).join('');
    }
    $('#grid').innerHTML = h;
  }
  const STATE = { queued: '排队中', making: '制作中', done: '已完成' };
  function orderRowSub(o) {
    const tot = (o.totalNutri && o.totalNutri.kcal) || itemKcal(o.def);
    const live = o.liveNutri ? o.liveNutri.kcal : 0;
    const calTxt = o.state === 'making' ? `🔥 ${live}/${tot} kcal` : `🔥 ${tot} kcal`;
    const sub = o.state === 'making' ? (o.step || '制作中') : o.state === 'done' ? '在出餐台，可取餐' : '等待制作';
    return `¥${o.def.price} · ${calTxt} · ${sub}`;
  }
  function renderCart() {
    const act = E.active();
    const totKcal = act.reduce((s, o) => s + ((o.totalNutri && o.totalNutri.kcal) || itemKcal(o.def)), 0);
    $('#cnt').textContent = act.length ? `${act.length} 件 · 约 ${totKcal} kcal` : '';
    $('#list').innerHTML = act.length ? act.map((o) => {
      return `<div class="row" data-o="${o.id}"><img src="${png(o.def.sprite)}" alt=""><div class="t"><b>${o.def.name}</b><i>${orderRowSub(o)}</i></div><span class="tag ${o.state}">${o.submitted ? "已下单" : STATE[o.state]}</span><button class="x" ${o.submitted ? 'disabled title="请在真实订单面板取消"' : 'title="移出餐盘"'}>×</button></div>`;
    }).join('') : '<div class="empty">还没有点单，点上面的商品试试</div>';
    $('#total').textContent = '¥' + act.filter((o) => !o.submitted).reduce((s, o) => s + o.def.price, 0);
    $('#pick').disabled = !act.some((o) => o.state === 'done');
    $('#clear').disabled = !act.some((o) => !o.submitted);
  }
  // 只刷新步骤与实时热量文字，避免整列重绘导致按钮点不中
  function refreshSteps() {
    for (const o of E.active()) {
      const row = document.querySelector(`.row[data-o="${o.id}"] i`);
      if (!row) continue;
      const t = orderRowSub(o);
      if (row.textContent !== t) row.textContent = t;
    }
  }

  /* ---------- 制作进度卡片 ----------
   * 只在订单变化时重建步骤格子；步骤推进时仅切换 class，所以过渡动画是连续的。
   * 实时同步汉堡堆叠/餐品制作的卡路里与三大营养素进度。
   * 取消 / 丢弃时卡片保持显示该订单并变红，等丢完再切到下一单或收起。 */
  const PG = { id: null, stage: -2, state: '', n: -1, kcal: -1, deltaTimer: null };
  function updatePgNutri(o, sad) {
    const tot = o.totalNutri || (MD.itemNutrition ? MD.itemNutrition(o.def) : { kcal: 0, protein: 0, fat: 0, carb: 0 });
    const live = o.state === 'done'
      ? { kcal: tot.kcal, protein: tot.protein, fat: tot.fat, carb: tot.carb, lastAdd: 0, lastLabel: '' }
      : (o.liveNutri || { kcal: 0, protein: 0, fat: 0, carb: 0, lastAdd: 0, lastLabel: '' });
    if (PG.kcal === live.kcal && PG.state === (o.state === 'done' ? PG.n : o.stage) + '|' + o.state) return;

    const prevKcal = PG.kcal;
    PG.kcal = live.kcal;

    const kcalEl = $('#pgKcal');
    if (kcalEl) {
      kcalEl.textContent = live.kcal;
      if (prevKcal >= 0 && live.kcal > prevKcal) {
        kcalEl.classList.remove('bump'); void kcalEl.offsetWidth; kcalEl.classList.add('bump');
      }
    }
    const targetEl = $('#pgTarget');
    if (targetEl) targetEl.textContent = `/ ${tot.kcal} kcal`;

    const deltaEl = $('#pgDelta');
    if (deltaEl) {
      if (prevKcal >= 0 && live.kcal > prevKcal && live.lastAdd > 0 && !sad) {
        deltaEl.textContent = `+${live.lastAdd} kcal${live.lastLabel ? ' · ' + live.lastLabel : ''}`;
        deltaEl.hidden = false;
        deltaEl.style.animation = 'none'; void deltaEl.offsetWidth; deltaEl.style.animation = '';
        clearTimeout(PG.deltaTimer);
        PG.deltaTimer = setTimeout(() => { deltaEl.hidden = true; }, 1400);
      } else if (live.kcal === 0 || sad) {
        deltaEl.hidden = true;
      }
    }

    const badgeEl = $('#pgBadge');
    if (badgeEl && MD.calorieLevel) {
      const refKcal = live.kcal > 0 ? live.kcal : tot.kcal;
      const lv = MD.calorieLevel(refKcal);
      badgeEl.textContent = (live.kcal > 0 ? '' : '预计 · ') + lv.label;
      badgeEl.className = 'pg-badge ' + lv.level;
    }

    const proEl = $('#pgPro'), fatEl = $('#pgFat'), carbEl = $('#pgCarb');
    if (proEl) proEl.textContent = live.protein.toFixed(1) + 'g';
    if (fatEl) fatEl.textContent = live.fat.toFixed(1) + 'g';
    if (carbEl) carbEl.textContent = live.carb.toFixed(1) + 'g';

    const proBar = $('#pgProBar'), fatBar = $('#pgFatBar'), carbBar = $('#pgCarbBar');
    if (proBar) proBar.style.width = Math.min(100, Math.round((live.protein / Math.max(tot.protein || 35, 1)) * 100)) + '%';
    if (fatBar) fatBar.style.width = Math.min(100, Math.round((live.fat / Math.max(tot.fat || 35, 1)) * 100)) + '%';
    if (carbBar) carbBar.style.width = Math.min(100, Math.round((live.carb / Math.max(tot.carb || 55, 1)) * 100)) + '%';
  }

  function progress() {
    const card = $('#prog');
    let o = E.focus;
    if (o && ['trashed', 'served', 'done'].includes(o.state) && o !== E.cur) {
      // 已经做完 / 丢完：如果后面还有排队的，转去看下一单；否则收起
      const nxt = E.orders.find((x) => x.state === 'making');
      o = nxt || (o.state === 'done' && Date.now() - (o._doneAt || (o._doneAt = Date.now())) < 1500 ? o : null);
    }
    if (!o || !o.steps || !o.steps.length) {
      if (PG.id !== null) { card.classList.add('hide'); PG.id = null; PG.kcal = -1; }
      return;
    }
    const sad = o.state === 'cancelled' || o.state === 'trashed';
    const n = o.steps.length;
    if (PG.id !== o.id) {                       // 切换了订单：重建
      PG.id = o.id; PG.stage = -2; PG.n = n; PG.kcal = -1;
      $('#pgImg').src = png(o.def.sprite);
      $('#pgName').textContent = o.def.name;
      $('#pgSteps').innerHTML = o.steps.map((s) => `<div class="stp"><div class="bx"></div><span>${s}</span></div>`).join('');
      $('#pgSteps').style.gridTemplateColumns = `repeat(${n <= 4 ? n : n <= 6 ? 3 : 4},minmax(0,1fr))`;
      card.classList.remove('hide'); card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap');
    }
    updatePgNutri(o, sad);
    const stage = o.state === 'done' ? n : o.stage;
    const key = stage + '|' + o.state;
    if (key === PG.state) return;
    PG.state = key;
    const cells = $('#pgSteps').children;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], was = c.classList.contains('done');
      const done = i < stage, now = i === stage && o.state === 'making';
      c.classList.toggle('done', done);
      c.classList.toggle('now', now);
      if (done && !was) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
    }
    const shown = Math.min(n, Math.max(0, stage + (o.state === 'making' ? 1 : 0)));
    $('#pgCnt').innerHTML = o.state === 'done' ? `<b>${n}</b> / ${n}` : sad ? '已取消' : `<b>${shown}</b> / ${n}`;
    $('#pgBar').style.width = (o.state === 'done' ? 100 : sad ? 0 : ((stage + 0.5) / n) * 100) + '%';
    $('#pgSub').textContent = sad ? '已取消 · 正在清理 · 订单 #' + String(o.id).padStart(3, '0')
      : o.state === 'done' ? '制作完成 · 订单 #' + String(o.id).padStart(3, '0')
      : '正在制作 · 订单 #' + String(o.id).padStart(3, '0');
    card.classList.toggle('sad', sad);
  }

  /* ---------- 后端接入: 选门店 / 真实菜单 / 结算 ----------
   * 后端不可达时 MD.API.online 为 false: 以上全部隐藏, 页面保持原来的离线演示。 */
  const money = (n) => '¥' + (Math.round(n * 100) / 100);
  function setSubtitle(t) { const s = $('#subtitle'); if (s) s.textContent = t; }
  function openStores() {
    const m = $('#storeModal'); m.style.display = 'flex';
    const box = $('#smList'); box.textContent = '加载中…';
    MD.API.stores().then((r) => {
      box.textContent = '';
      if (!r.stores.length) { box.textContent = '暂时没有可用门店'; return; }
      r.stores.forEach((s) => {
        const b = document.createElement('button');
        b.className = 'btn g'; b.type = 'button'; b.style.cssText = 'display:block;width:100%;text-align:left;margin-top:6px;border-radius:12px';
        const n = document.createElement('b'); n.textContent = s.name.replace('麦当劳', '');
        const d = document.createElement('div'); d.style.cssText = 'font-size:12px;font-weight:400;color:#6f6b63'; d.textContent = (s.address || '') + ' · ' + (s.hours || '');
        b.append(n, d); b.onclick = () => pickStore(s); box.appendChild(b);
      });
    }).catch((e) => { box.textContent = e.message; });
  }
  async function pickStore(s) {
    try {
      await MD.API.chooseStore(s);
      $('#storeModal').style.display = 'none';
      if (!MD.CATS.some((c) => c.id === cat)) cat = MD.CATS[0].id;
      E.active().slice().reverse().forEach((o) => E.cancel(o));  // 换店后旧订单的商品可能已不存在
      renderCats(); renderGrid(); renderCart();
      setSubtitle(s.name.replace('麦当劳', '') + ' · 真实菜单');
      toast('已切换到 ' + s.name.replace('麦当劳', ''));
    } catch (e) {
      // 打烊店等: 后端返回的是可直接给用户看的原因
      const p = document.createElement('p'); p.style.cssText = 'color:#d6221a;font-size:13px;margin:6px 0'; p.textContent = e.message;
      $('#smList').prepend(p);
    }
  }
  async function doCheckout() {
    const act = E.active().filter((o) => !o.submitted);
    if (!act.length) { toast('没有待下单的餐品'); return; }
    const btn = $('#checkout'); btn.disabled = true;
    try {
      const p = await MD.API.checkout(act);
      const off = p.discount ? '，已优惠 ' + money(p.discount) : '';
      toast('应付 ' + money(p.price) + off);
      orderPanel.onCreated = () => {
        act.forEach((o) => { o.submitted = true; });
        MD.API.pending = null; renderCart();
      };
      orderPanel.showQuote(p);
      $('#total').textContent = money(p.price);
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  }
  /* 启动时自动选店：成功就直接是真实菜单；失败就保持离线演示菜单，并把原因写在副标题里，
   * 不再弹窗打断（想换店随时点右上角「选门店」）。 */
  async function autoPick() {
    setSubtitle('正在连接门店…');
    try {
      const r = await MD.API.autoStore();
      if (!MD.CATS.some((c) => c.id === cat)) cat = MD.CATS[0].id;
      renderCats(); renderGrid(); renderCart();
      const name = (r.store.name || '').replace('麦当劳', '');
      const skipped = r.tried && r.tried.length ? '（已跳过 ' + r.tried.length + ' 家未营业的店）' : '';
      setSubtitle(name + ' · 真实菜单');
      if (skipped) toast('已为你选了营业中的「' + name + '」' + skipped);
    } catch (e) {
      setSubtitle('离线演示菜单（价格是示例） · ' + e.message);
    }
  }

  function bindStore() {
    const A = MD.API;
    if (!A || !A.online) return;                       // 离线: 保持原样
    $('#store').hidden = false; $('#checkout').hidden = false;
    $('#store').addEventListener('click', openStores);
    $('#smClose').addEventListener('click', () => { $('#storeModal').style.display = 'none'; });
    orderPanel = new McdOrders({ api: A.call, sessionId: () => A.sid, demo: A.demo });
    orderPanel.restore().catch((e) => toast(e.message));
    $('#checkout').addEventListener('click', doCheckout);
    autoPick();
  }

  function bind() {
    $('#cats').addEventListener('click', (e) => { const b = e.target.closest('.cat'); if (!b) return; cat = b.dataset.c; renderCats(); renderGrid(); });
    $('#grid').addEventListener('click', (e) => {
      const c = e.target.closest('.card'); if (!c) return;
      c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
      if (c.dataset.combo) { MD.COMBOS.find((x) => x.id === c.dataset.combo).items.forEach((id) => E.add(id)); }
      else E.add(c.dataset.p);
    });
    $('#list').addEventListener('click', (e) => {
      const b = e.target.closest('.x'); if (!b) return;
      const row = b.closest('.row'); if (!row) return;
      const id = +row.dataset.o, o = E.orders.find((x) => x.id === id);
      if (!o || o.submitted || !['queued', 'making', 'done'].includes(o.state)) return; // 已被取消或点重了
      E.cancel(o);
      b.disabled = true; // 防止重复点击
    });
    $('#clear').addEventListener('click', () => E.active().filter((o) => !o.submitted).slice().reverse().forEach((o) => E.cancel(o)));
    $('#pick').addEventListener('click', () => { E.pickup(); toast('顾客已取餐，祝用餐愉快'); });
    bindStore();
    document.querySelectorAll('#hud button').forEach((b) => b.addEventListener('click', () => {
      E.speed = +b.dataset.s; document.querySelectorAll('#hud button').forEach((x) => x.classList.toggle('on', x === b));
    }));
  }

  Promise.all([MD.loadImages(), MD.API ? MD.API.init() : null]).then(() => {
    E = MD.engine = new MD.Engine();
    const cv = $('#cv'), c = cv.getContext('2d');
    c.imageSmoothingEnabled = true;
    renderCats(); renderGrid(); renderCart(); bind();
    E.on(renderCart);
    document.dispatchEvent(new Event('md:ready'));   // js/npc.js 等扩展在引擎就绪后挂接
    let last = performance.now();
    (function frame(now) {
      E.tick(now - last); last = now;
      MD.render(c, E);
      refreshSteps();
      progress();
      requestAnimationFrame(frame);
    })(last);
  });
})();
