/* 右侧点餐界面 + 主循环 */
(function () {
  const MD = window.MD, $ = (s) => document.querySelector(s);
  const png = (k) => 'assets/sprites/' + k + '.png';
  let cat = 'burger', E = null;
  const toast = (t) => { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => e.classList.remove('show'), 1600); };

  function renderCats() {
    $('#cats').innerHTML = MD.CATS.map((c) => `<button class="cat ${c.id === cat ? 'on' : ''}" data-c="${c.id}"><img src="${png(c.icon)}" alt=""><span>${c.name}</span></button>`).join('');
  }
  function renderGrid() {
    let h = '';
    if (cat === 'combo') {
      h = MD.COMBOS.map((c) => `<div class="card" data-combo="${c.id}"><span class="combo">套餐</span><span class="plus">+</span><img src="${png(c.sprite)}" alt=""><div class="n">${c.name}</div><div class="sub">${c.items.map((i) => MD.P[i].name).join(' + ')}</div><div class="p">${c.price}</div></div>`).join('');
    } else {
      h = MD.LIST.filter((p) => p.cat === cat).map((p) => `<div class="card" data-p="${p.id}"><span class="plus">+</span><img src="${png(p.sprite)}" alt=""><div class="n">${p.name}</div><div class="p">${p.price}</div></div>`).join('');
    }
    $('#grid').innerHTML = h;
  }
  const STATE = { queued: '排队中', making: '制作中', done: '已完成' };
  function renderCart() {
    const act = E.active();
    $('#cnt').textContent = act.length ? `${act.length} 件` : '';
    $('#list').innerHTML = act.length ? act.map((o) => {
      const sub = o.state === 'making' ? (o.step || '制作中') : o.state === 'done' ? '在出餐台，可取餐' : '等待制作';
      return `<div class="row" data-o="${o.id}"><img src="${png(o.def.sprite)}" alt=""><div class="t"><b>${o.def.name}</b><i>¥${o.def.price} · ${sub}</i></div><span class="tag ${o.state}">${STATE[o.state]}</span><button class="x" title="取消">×</button></div>`;
    }).join('') : '<div class="empty">还没有点单，点上面的商品试试</div>';
    $('#total').textContent = '¥' + act.reduce((s, o) => s + o.def.price, 0);
    $('#pick').disabled = !act.some((o) => o.state === 'done');
    $('#clear').disabled = !act.length;
  }
  // 只刷新步骤文字，避免整列重绘导致按钮点不中
  function refreshSteps() {
    for (const o of E.active()) {
      const row = document.querySelector(`.row[data-o="${o.id}"] i`);
      if (!row) continue;
      const sub = o.state === 'making' ? (o.step || '制作中') : o.state === 'done' ? '在出餐台，可取餐' : '等待制作';
      const t = `¥${o.def.price} · ${sub}`; if (row.textContent !== t) row.textContent = t;
    }
  }

  /* ---------- 制作进度卡片 ----------
   * 只在订单变化时重建步骤格子；步骤推进时仅切换 class，所以过渡动画是连续的。
   * 取消 / 丢弃时卡片保持显示该订单并变红，等丢完再切到下一单或收起。 */
  const PG = { id: null, stage: -2, state: '', n: -1 };
  function progress() {
    const card = $('#prog');
    let o = E.focus;
    if (o && ['trashed', 'served', 'done'].includes(o.state) && o !== E.cur) {
      // 已经做完 / 丢完：如果后面还有排队的，转去看下一单；否则收起
      const nxt = E.orders.find((x) => x.state === 'making');
      o = nxt || (o.state === 'done' && Date.now() - (o._doneAt || (o._doneAt = Date.now())) < 1500 ? o : null);
    }
    if (!o || !o.steps || !o.steps.length) {
      if (PG.id !== null) { card.classList.add('hide'); PG.id = null; }
      return;
    }
    const sad = o.state === 'cancelled' || o.state === 'trashed';
    const n = o.steps.length;
    if (PG.id !== o.id) {                       // 切换了订单：重建
      PG.id = o.id; PG.stage = -2; PG.n = n;
      $('#pgImg').src = png(o.def.sprite);
      $('#pgName').textContent = o.def.name;
      $('#pgSteps').innerHTML = o.steps.map((s) => `<div class="stp"><div class="bx"></div><span>${s}</span></div>`).join('');
      $('#pgSteps').style.gridTemplateColumns = `repeat(${n <= 4 ? n : n <= 6 ? 3 : 4},minmax(0,1fr))`;
      card.classList.remove('hide'); card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap');
    }
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
      if (!o || !['queued', 'making', 'done'].includes(o.state)) return; // 已被取消或点重了
      E.cancel(o);
      b.disabled = true; // 防止重复点击
    });
    $('#clear').addEventListener('click', () => E.active().slice().reverse().forEach((o) => E.cancel(o)));
    $('#pick').addEventListener('click', () => { E.pickup(); toast('顾客已取餐，祝用餐愉快'); });
    document.querySelectorAll('#hud button').forEach((b) => b.addEventListener('click', () => {
      E.speed = +b.dataset.s; document.querySelectorAll('#hud button').forEach((x) => x.classList.toggle('on', x === b));
    }));
  }

  MD.loadImages().then(() => {
    E = MD.engine = new MD.Engine();
    const cv = $('#cv'), c = cv.getContext('2d');
    c.imageSmoothingEnabled = true;
    renderCats(); renderGrid(); renderCart(); bind();
    E.on(renderCart);
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
