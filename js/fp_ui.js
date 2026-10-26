/* 汉堡小游戏 · 界面：选单大厅、食谱、HUD、结算、渲染循环。 */
(function () {
  const FP = window.FP;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const png = (id) => 'assets/fp/' + (id[0] === 'B' ? 'burger/' : 'ing/') + id + '.png';
  const sfx = (n, o) => { try { FP.sfx && FP.sfx.play(n, o); } catch (e) { /* 忽略 */ } };
  let G = null, canvas, ctx, raf = 0, last = 0, dpr = 1;
  const UI = { screen: 'hall', selected: null, mode: 'recipe' };
  window.__fpSkipTransition = /skip(=1|\b)/.test(location.search + location.hash);   // 调试用

  /* ---------- 缩略图缓存 ----------
   * 配料原图有 300px 宽，直接 drawImage 到 60px 会每帧做一次高质量缩放（很贵）。
   * 这里预先把每张图缩成 ~120px 的小画布，渲染时直接用。 */
  const THUMB = {};
  function thumbOf(key, src) {
    if (THUMB[key]) return THUMB[key];
    const im = FP.IMG && FP.IMG[key];
    if (!im || !im.width) return null;
    const w = 120, h = Math.max(1, Math.round(w * im.height / im.width));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(im, 0, 0, w, h);
    THUMB[key] = cv;
    void src;
    return cv;
  }
  FP.thumbOf = thumbOf;

  /* ---------- 小工具 ---------- */
  function toast(msg) {
    const el = $('#fp-toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => el.classList.remove('on'), 1700);
  }
  function stars(n) {
    let s = '';
    for (let i = 0; i < 3; i++) s += `<i class="${i < n ? 'on' : ''}">★</i>`;
    return s;
  }
  /* 点中料架时轻弹一下，给个手感反馈 */
  function bump(el) {
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  /* ---------- 大厅 ---------- */
  function hallCards() {
    return FP.RECIPES.map((r) => `
      <button class="fp-card" data-rec="${r.id}">
        <span class="fp-diff">${'●'.repeat(r.difficulty)}</span>
        <img src="${png(r.id)}" alt="${r.name}">
        <b>${r.name}</b>
        <em>${r.stack.length} 层 · ¥${FP.price(r.stack).toFixed(1)}</em>
      </button>`).join('');
  }
  function showHall() {
    UI.screen = 'hall';
    stopLoop();
    $('#fp-game').classList.remove('on');
    $('#fp-hall').classList.add('on');
    $('#fp-cards').innerHTML = hallCards();
    $('#fp-stat').textContent = '共 ' + FP.RECIPES.length + ' 份食谱 · ' + FP.ING_LIST.length + ' 种配料';
  }
  /* 回大厅也走一遍小票转场（结账小票），画面盖住时才切换 */
  function goHome(caption) {
    if (UI.screen === 'hall' && !$('#fp-result').classList.contains('on')) return;
    transitionThen({ caption: caption || '结账完成 · 欢迎光临 mcd.cn' }, () => {
      $('#fp-result').classList.remove('on');
      showHall();
    });
  }

  /* ---------- 食谱小票（右侧/左侧面板） ---------- */
  function recipePanel(rec) {
    const rows = rec.stack.map((id) => {
      const it = FP.ING[id];
      return `<li data-id="${id}"><img src="${png(id)}" alt=""><span>${it.name}</span></li>`;
    }).join('');
    $('#fp-ticket-title').textContent = rec.name;
    $('#fp-ticket-blurb').textContent = rec.blurb;
    $('#fp-ticket-rows').innerHTML = rows;
    $('#fp-ticket-meta').textContent = `${rec.stack.length} 层 · ¥${FP.price(rec.stack).toFixed(1)} · ${FP.kcal(rec.stack)} kcal`;
    $('#fp-ticket').classList.add('on');
  }
  function markRecipeProgress(g) {
    const rec = g.recipe;
    if (!rec) return;
    // 出餐后 items 已经清空，进度条会瞬间归零；此时保持满格到离开当前页
    if (g.served && g.served.kind === 'recipe') return;
    const pr = FP.progress(rec, g.plan());
    $$('#fp-ticket-rows li').forEach((li, i) => {
      li.classList.toggle('done', i < pr.matched);
      li.classList.toggle('bad', i === pr.matched && pr.wrong);
      li.classList.toggle('now', i === pr.matched && !pr.wrong);
    });
    $('#fp-ticket-prog').style.width = (pr.matched / rec.stack.length * 100) + '%';
  }

  /* ---------- HUD ---------- */
  function hud(g) {
    const ids = g.plan();
    const placed = g.ids().length;
    $('#fp-count').textContent = ids.length
      ? (g.busy && g.busy !== 'serve' ? '取料中…' : ids.length + ' 层')
      : '空砧板';
    const st = g.recipe ? FP.progress(g.recipe, g.ids()) : null;
    $('#fp-hint').textContent = g.recipe
      ? (st.done ? '完成！点「出餐」验收' : st.wrong ? '这一步和食谱不一样，可以撤销重来' : st.next ? '下一步：' + FP.ING[st.next].name : '')
      : (ids.length ? '自由发挥中，点「出餐」评分' : '从下面的料台选一样放到面包上');
    $('#fp-undo').disabled = !placed || !!g.busy;
    $('#fp-clear').disabled = !ids.length || !!g.busy;
    $('#fp-serve').disabled = !placed || !!g.busy;
  }

  /* ---------- 料架 ---------- */
  function shelf(cat) {
    UI.cat = cat;
    const list = FP.ingByCat(cat);
    $('#fp-shelf-items').innerHTML = list.map((it) => `
      <button class="fp-item" data-id="${it.id}" title="${it.name}" aria-label="${it.name}">
        <img src="${png(it.id)}" alt=""><span>${it.name.replace(/（.*）/, '')}</span>
      </button>`).join('');
    $('#fp-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.cat === cat));
    SHELF.sig = '';   // 换分类后必须重建一次可用状态/高亮
    refreshShelfEnabled(true);
  }
  /* 料架上哪些能加、哪些不能：按「已放好 + 飞行中 + 排队」整体判断。
   * 每帧调用太重，这里用状态签名做脏检查，只有真的变了才动 DOM。 */
  const SHELF = { sig: '' };
  function refreshShelfEnabled(force) {
    if (!G || UI.screen !== 'game') return;
    const plan = G.plan();
    const sig = plan.join(',') + '|' + (G.served ? 's' : '') + '|' + (G.busy ? 'b' : '');
    if (!force && sig === SHELF.sig) return;
    SHELF.sig = sig;
    // 食谱模式下算出「下一步该放什么」，料架里把它高亮出来，省得来回看小票
    let want = null;
    if (G.recipe && !G.served) {
      const pr = FP.progress(G.recipe, plan);
      if (!pr.done && !pr.wrong) want = pr.next;
    }
    $$('#fp-shelf-items .fp-item').forEach((b) => {
      const chk = FP.canPlace(plan, b.dataset.id);
      b.classList.toggle('off', !chk.ok);
      b.classList.toggle('want', b.dataset.id === want);
      b.title = chk.ok ? FP.ING[b.dataset.id].name : chk.why;
      b.setAttribute('aria-disabled', chk.ok ? 'false' : 'true');
    });
  }

  /* ---------- 渲染循环 ---------- */
  function fit() {
    const box = $('#fp-stage').getBoundingClientRect();
    const s = Math.min(box.width / window.FP_LAYOUT.W, box.height / window.FP_LAYOUT.H);
    canvas.style.width = Math.round(window.FP_LAYOUT.W * s) + 'px';
    canvas.style.height = Math.round(window.FP_LAYOUT.H * s) + 'px';
  }
  function frame(now) {
    const dt = Math.min(50, now - last || 16);
    last = now;
    if (G) {
      G.update(dt);
      // 正在下落的那一层单独画（带自己的 offY），否则它会提前把整叠“撑高”，影子也会跳位
      const items = G.items;
      const falling = G.busy && G.busy !== 'serve' && items.length ? items[items.length - 1] : null;
      const isFalling = !!falling && Math.abs(falling.offY) > 0.5;
      const settled = isFalling ? items.slice(0, -1) : items;
      const layers = FP.layersOf(settled, G.stackPos[0], G.stackPos[1]);
      const drop = Math.min(46, settled.length * 4);
      for (const l of layers) {
        l.yBottom += drop; l.surface += drop;
        if (l.seam !== undefined) l.seam += drop;
      }
      let flyLayer = null;
      if (isFalling) {
        const one = FP.layersOf([falling], G.stackPos[0],
          layers.surface + (FP.ING[falling.id].rise || 0) + drop)[0];
        flyLayer = one;
      }
      FP.drawScene(ctx, {
        layers,
        flying: flyLayer,
        stackPos: G.stackPos,
        hands: G.hands,
        parts: G.parts,
        hold: G.hold,
        under: (c) => {
          // 食谱模式下，在砧板上方半透明预览「下一层该放什么」
          if (!G.recipe || G.served || G.busy || G.items.length === 0) return;
          const pr = FP.progress(G.recipe, G.plan());
          const nx = pr.next;
          if (!nx || pr.done || pr.wrong) return;
          const it = FP.ING[nx];
          const ghost = ['sauce', 'sprinkle'].includes(it.role);
          c.save();
          c.globalAlpha = 0.2 + Math.sin(now / 460) * 0.07;
          if (ghost) {
            c.fillStyle = FP.sauceColor(nx);
            c.beginPath();
            c.ellipse(G.stackPos[0], layers.surface + 6, 120, 16, 0, 0, Math.PI * 2);
            c.fill();
          } else {
            FP.spr(c, nx, G.stackPos[0], layers.surface + 4, it.w * 0.92);
          }
          c.restore();
        },
      });
      markRecipeProgress(G);
      refreshShelfEnabled();
    }
    raf = requestAnimationFrame(frame);
  }
  function startLoop() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  /* ---------- 转场包装 ----------
   * 所有「换场景」的动作都先播 M-CODE 小票，画面全盖住（onCover）时才真正切换。
   * 没有转场模块或被 URL 关掉时直接切，保证任何情况下都不卡死。 */
  function transitionThen(opts, swap) {
    let done = false;
    const once = () => { if (!done) { done = true; swap(); } };
    if (window.__fpSkipTransition || !(FP.transition && FP.transition.play)) { once(); return; }
    try {
      FP.transition.play(Object.assign({ onCover: once }, opts)).then(once, once);
    } catch (e) { once(); }
    // 兜底：万一转场模块没回调，也不让玩家卡在中间
    setTimeout(once, (opts && opts.duration ? opts.duration : 2800) + 3000);
  }

  /* ---------- 进入游戏 ---------- */
  /* 从大厅进场：先用 M-CODE 小票转场盖住，onCover 时再切到后厨 */
  function enter(recId) {
    const rec = recId ? FP.recipeById(recId) : null;
    transitionThen({ title: "1024 PROGRAMMER'S DAY",
      caption: rec ? '订单已接收：' + rec.name : '自由创作模式 · 想放什么就放什么' },
    () => enterNow(recId, rec));
  }
  /* 真正的切换（不带转场） */
  function enterNow(recId, rec) {
    rec = rec || (recId ? FP.recipeById(recId) : null);
    $('#fp-hall').classList.remove('on');
    $('#fp-game').classList.add('on');
    UI.screen = 'game';
    UI.selected = recId;
    $('#fp-ticket').classList.toggle('on', !!rec);
    if (rec) {
      recipePanel(rec);
      // 窄屏时食谱改成浮层默认收起，点 HUD 的「食谱」再看
      if (window.innerWidth <= 900) $('#fp-ticket').classList.remove('on');
    } else $('#fp-ticket').classList.remove('on');
    fit();
    G = new FP.Game({ on: onGameEvent });
    G.start({ mode: rec ? 'recipe' : 'free', recipe: rec });
    shelf(rec ? 'bun' : (UI.cat || 'bun'));
    hud(G);
    startLoop();
  }

  function onGameEvent(kind, data, g) {
    if (kind === 'toast') toast(data);
    if (kind === 'change') hud(g);
    if (kind === 'served') showResult(data);
  }

  /* ---------- 结算 ---------- */
  function showResult(res) {
    const good = res.stars >= 2;
    const title = res.kind === 'recipe'
      ? (res.stars === 3 ? '完美复刻' : res.stars === 2 ? '几乎完美' : '还需要练习')
      : (res.valid ? '创意汉堡完成' : '还不能出餐');
    const notes = res.notes || [res.message];
    const img = res.burger ? png(res.burger) : null;
    $('#fp-result').innerHTML = `
      <div class="fp-receipt">
        <div class="fp-r-head"><b>M-CODE</b><i>${new Date().toLocaleString('zh-CN', { hour12: false })}</i></div>
        <h3>${title}</h3>
        <div class="fp-r-stars">${stars(res.stars)}</div>
        ${img ? `<img class="fp-r-img" src="${img}" alt="">` : `<div class="fp-r-stack">${(res.stackPreview || []).slice(-5).map((id) => `<img src="${png(id)}" alt="">`).join('')}</div>`}
        <div class="fp-r-name">${res.name}</div>
        <div class="fp-r-blurb">${res.blurb || ''}</div>
        <ul class="fp-r-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
        <div class="fp-r-meta"><span>¥${(res.price || 0).toFixed(1)}</span><span>${res.kcal || 0} kcal</span></div>
        <div class="fp-r-foot">感谢惠顾 · mcd.cn</div>
        <div class="fp-r-actions">
          <button class="fp-btn y" id="fp-again">再来一个</button>
          <button class="fp-btn g" id="fp-back">回到大厅</button>
        </div>
      </div>`;
    $('#fp-result').classList.add('on');
    sfx(res.stars === 3 ? 'good' : good ? 'ok' : 'bad');
    $('#fp-again').onclick = () => {
      $('#fp-result').classList.remove('on');
      sfx('click');
      const rec = UI.selected ? FP.recipeById(UI.selected) : null;
      const reset = () => { G.start({ mode: rec ? 'recipe' : 'free', recipe: rec }); hud(G); };
      transitionThen({ duration: 1900,
        caption: rec ? '再来一份：' + rec.name : '再来一个自由创作' }, reset);
    };
    $('#fp-back').onclick = () => { sfx('click'); goHome(); };
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $('#fp-cards').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rec]');
      if (!b) return;
      sfx('click');
      enter(b.dataset.rec);
    });
    $('#fp-free').addEventListener('click', () => { sfx('click'); enter(null); });
    $('#fp-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      sfx('click');
      shelf(b.dataset.cat);
    });
    $('#fp-shelf-items').addEventListener('click', (e) => {
      const b = e.target.closest('.fp-item');
      if (!b || !G) return;
      // 不能加的料：给出原因，不进入排队
      if (b.getAttribute('aria-disabled') === 'true') { toast(b.title || '这一层现在放不上去'); sfx('bad'); return; }
      if (G.add(b.dataset.id)) { sfx('click'); bump(b); }
    });
    $('#fp-undo').addEventListener('click', () => { sfx('click'); G.undo(); });
    $('#fp-clear').addEventListener('click', () => { sfx('click'); G.clear(); });
    $('#fp-serve').addEventListener('click', () => { sfx('click'); G.serve(); });
    $('#fp-home').addEventListener('click', () => { sfx('click'); goHome('下班了 · 结账完成 mcd.cn'); });
    $('#fp-ticket-toggle').addEventListener('click', () => {
      const t = $('#fp-ticket');
      // 没有食谱时按钮不起作用（自由创作模式）
      if (!G || !G.recipe) { toast('自由创作模式没有食谱'); return; }
      t.classList.toggle('on');
      sfx('click');
    });
    $('#fp-ticket-close').addEventListener('click', () => {
      $('#fp-ticket').classList.remove('on');
      UI.selected = null;
      if (G) { G.recipe = null; G.mode = 'free'; hud(G); }
    });
    $('#fp-sound').addEventListener('click', () => {
      const on = !(FP.sfx && FP.sfx.enabled);
      FP.sfx && FP.sfx.setEnabled(on);
      $('#fp-sound').classList.toggle('off', !on);
      sfx('click');
    });
    // 键盘：1-6 切分类，Backspace/Z 撤销，Esc 回大厅，Enter 出餐
    document.addEventListener('keydown', (e) => {
      if (UI.screen !== 'game' || !G) return;
      if (e.key >= '1' && e.key <= '6') { const c = FP.CATS[+e.key - 1]; if (c) { shelf(c.id); sfx('click'); } }
      else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') { e.preventDefault(); G.undo(); }
      else if (e.key === 'Enter') { G.serve(); }
      else if (e.key === 'Escape') { goHome('下班了 · 结账完成 mcd.cn'); }
    });
    window.addEventListener('resize', fit);
    document.addEventListener('pointerdown', () => { try { FP.sfx && FP.sfx.unlock(); } catch (e) { /* 忽略 */ } }, { once: true });
  }

  /* ---------- 预加载缩略图 ---------- */
  function preloadThumbs() {
    const ids = FP.ING_LIST.map((i) => i.id).concat(FP.RECIPES.map((r) => r.id));
    ids.forEach((id) => { const im = new Image(); im.src = png(id); });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    canvas = $('#fp-cv');
    ctx = canvas.getContext('2d');
    canvas.width = window.FP_LAYOUT.W;
    canvas.height = window.FP_LAYOUT.H;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    $('#fp-tabs').innerHTML = FP.CATS.map((c) => `<button data-cat="${c.id}"><img src="${png(c.icon)}" alt=""><span>${c.name}</span></button>`).join('');
    bind();
    window.FP_UI = { enter, showHall, UI, game: () => G };
    if (FP.sfx && FP.sfx.enabled === false) $('#fp-sound').classList.add('off');
    if (location.hash.startsWith('#play')) {
      const id = location.hash.slice(5);
      FP.loadImages().then(() => { showHall(); enter(FP.recipeById(id) ? id : null); });
    } else {
      FP.loadImages().then(showHall);
    }
    preloadThumbs();
    window.FP_READY = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
