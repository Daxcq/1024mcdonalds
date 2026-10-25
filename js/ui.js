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
      requestAnimationFrame(frame);
    })(last);
  });
})();
