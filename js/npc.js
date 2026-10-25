/* 小麦对话: 在后厨画面里按 F(或点头顶提示 / 点小人)进入全屏二次元对话页。
 * 选项: 点单 / 今日推荐 / 玩游戏(汉堡工坊) / 选门店 / 取餐 / 结算 / 聊两句 / 离开。
 * 只依赖 MD.engine / MD.API / MD.P / MD.LIST / MD.CATS / MD.COMBOS, 不改动引擎。对话期间后厨暂停(E.speed=0)。 */
(function (g) {
  const MD = g.MD, doc = document;
  const $ = (s) => doc.querySelector(s);
  const png = (k) => 'assets/sprites/' + k + '.png';
  const money = (n) => '¥' + (Math.round(n * 100) / 100);
  const reduce = g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let E = null, root = null, open = false, prevSpeed = 1, prevFocus = null;
  let box, textEl, srEl, choicesEl, portrait, locEl, sheet, tip;
  let queue = [], pending = null, typingTimer = null, curText = '', typing = false;
  let sheetOpen = false, sheetCat = null, chatIdx = 0, recIdx = 0;
  const cardRefs = new Map();

  function toast(t) {
    let e = $('.npc-toast'); if (!e) { e = el('div', 'npc-toast'); e.setAttribute('role', 'status'); doc.body.appendChild(e); }
    e.textContent = t; e.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => e.classList.remove('show'), 1800);
  }
  const storeLabel = () => (MD.API && MD.API.store ? MD.API.store.name.replace('麦当劳', '') : '');
  const online = () => !!(MD.API && MD.API.online);

  /* ---------- 对话文字: 逐字显示, 点击/回车/空格直接显示完 ---------- */
  function finishTyping() {
    if (!typing) return;
    clearInterval(typingTimer); typing = false; textEl.textContent = curText; lineDone(false);
  }
  /* auto=true: 自然打完, 把焦点交给第一个选项; 玩家手动跳过时不抢焦点, 避免空格键"跳字"后在选项上松开而误触 */
  function lineDone(auto) {
    box.classList.toggle('more', queue.length > 0);
    portrait.classList.remove('talk');
    srEl.textContent = curText;                        // 读屏只在整句完成后播报一次
    if (!queue.length) showChoices(!!auto);
  }
  function type(text) {
    curText = text; textEl.textContent = ''; box.classList.remove('more'); hideChoices();
    if (reduce) { typing = false; textEl.textContent = text; lineDone(true); return; }
    typing = true; portrait.classList.add('talk');
    let i = 0;
    typingTimer = setInterval(() => {
      i++; textEl.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(typingTimer); typing = false; lineDone(true); }
    }, 32);
  }
  function show(lines, choices) {
    queue = (Array.isArray(lines) ? lines : [lines]).slice();
    pending = choices; clearInterval(typingTimer); typing = false;
    type(queue.shift());
  }
  function advance() {
    if (typing) finishTyping();
    else if (queue.length) type(queue.shift());
    else if (!choicesEl.hidden && choicesEl.firstElementChild) choicesEl.firstElementChild.focus({ preventScroll: true });
  }

  /* ---------- 选项 ---------- */
  function hideChoices() { choicesEl.hidden = true; choicesEl.replaceChildren(); }
  function showChoices(focus = true) {
    const list = typeof pending === 'function' ? pending() : pending;
    if (!list || !list.length || sheetOpen) return;
    choicesEl.replaceChildren(...list.map((c, i) => {
      const b = el('button', 'vn-choice' + (c.back ? ' back' : '')); b.type = 'button';
      b.append(el('kbd', '', String(i + 1)), el('span', '', c.label));
      if (c.hint) b.append(el('small', '', c.hint));
      b.onclick = () => c.run();
      return b;
    }));
    choicesEl.hidden = false;
    if (focus) choicesEl.firstElementChild.focus({ preventScroll: true });
  }

  /* ---------- 对话脚本 ---------- */
  const active = () => (E ? E.active() : []);
  const readyN = () => active().filter((o) => o.state === 'done').length;
  function rootLines() {
    const a = active().length, r = readyN();
    if (r) return `你的餐有 ${r} 份做好啦,放在出餐台了~还需要点什么吗?`;
    if (a) return `后厨正在做你点的 ${a} 份餐,稍等一下哦。趁现在,要不要再看看别的?`;
    return '欢迎光临,我是小麦!今天想吃点什么?也可以先陪我聊两句~';
  }
  function rootChoices() {
    const a = active().length, r = readyN(), list = [
      { label: '点单', hint: a ? `订单 ${a} 件` : '', run: doOrder },
      { label: '今日推荐', run: doRecommend },
    ];
    if (a) list.push({ label: '取餐', hint: r ? `已做好 ${r} 份` : '还在做', run: doPickup });
    list.push({ label: '玩游戏', hint: '汉堡工坊', run: doGame });
    if (online()) list.push({ label: '选门店', hint: storeLabel() || '未选', run: doStore });
    list.push({ label: '聊两句', run: doChat }, { label: '离开', back: true, run: leave });
    return list;
  }
  const toRoot = (lines) => show(lines || rootLines(), rootChoices);
  const backChoice = { label: '返回', back: true, run: () => toRoot() };

  function doOrder() { show('菜单给你~想吃什么点 + 就行,后厨马上开做。', null); openSheet(); }
  function doRecommend() {
    const list = MD.LIST.filter((p) => p.cat !== 'combo');
    if (!list.length) { show('菜单还没准备好,稍后再来问我吧。', rootChoices); return; }
    const p = list[recIdx++ % list.length];
    show(`推荐你试试「${p.name}」,${money(p.price)}。要来一份吗?`, [
      { label: `来一份「${p.name}」`, hint: money(p.price), run: () => { E.add(p.id); show(`好嘞,「${p.name}」马上开做!还要别的吗?`, rootChoices); } },
      { label: '换一个', run: doRecommend },
      backChoice,
    ]);
  }
  function doPickup() {
    if (readyN()) { E.pickup(); show('给你~小心烫,祝用餐愉快!还需要别的吗?', rootChoices); }
    else if (active().length) show('还在做呢,再等一下下~', rootChoices);
    else show('你还没点单哦。', rootChoices);
  }
  function doGame() {
    const n = active().length;
    show(n ? `汉堡工坊是另一个场地,现在的 ${n} 份订单不会保留哦。真的要过去吗?`
           : '汉堡工坊!把面包、肉排、配料一层层拼起来,拼出店里真有的汉堡。要过去玩玩吗?', [
      { label: '去汉堡工坊', hint: '换页面', run: () => { g.location.href = '/workshop'; } },
      { label: '再想想', back: true, run: () => toRoot() },
    ]);
  }
  function doStore() {
    show('选一家门店吧,菜单和价格都会换成那家店的。', [
      { label: '去选门店', run: () => { leave(); setTimeout(() => { const b = $('#store'); if (b) b.click(); }, reduce ? 20 : 320); } },
      backChoice,
    ]);
  }
  const CHAT = [
    ['后厨的汉堡都是现做的哦。', '牛肉饼先上煎台,鸡排先下炸锅,顺序错了可不行。'],
    ['订单多的时候后厨会排队,一份一份来。', '不要着急,我手脚很快的!'],
    ['点错了也没关系,订单里点 × 就能取消。', '……不过做了一半的,我会伤心地丢进垃圾桶。'],
    ['想自己动手搭汉堡吗?', '选「玩游戏」,去汉堡工坊,按配方拼出店里真有的汉堡。'],
  ];
  function doChat() { show(CHAT[chatIdx++ % CHAT.length].concat('还想聊点什么?'), rootChoices); }   // 多句: 点击对话框翻页

  /* ---------- 对话里的点单面板 ---------- */
  const qtyOf = (pid) => active().filter((o) => o.pid === pid).length;
  function buildSheet() {
    sheet = el('section', 'vn-sheet'); sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', '点单');
    const h = el('header'); h.append(el('b', '', '点单'), el('small', '', ''), el('span', 'sp'));
    h.children[1].id = 'npcShStore';
    const close = el('button', 'vn-chip', '返回对话'); close.type = 'button'; close.onclick = closeSheet; h.append(close);
    const body = el('div', 'sheet-body'), tabs = el('nav', 'sheet-tabs'), grid = el('div', 'sheet-grid');
    tabs.setAttribute('aria-label', '分类'); tabs.id = 'npcShTabs'; grid.id = 'npcShGrid'; body.append(tabs, grid);
    const f = el('footer'), sum = el('div', 'sheet-sum');
    const total = el('b', 'sheet-total', '¥0'); total.id = 'npcShTotal';
    const quote = el('span', 'sheet-quote', ''); quote.id = 'npcShQuote'; sum.append(total, quote);
    const done = el('button', 'vn-btn', '点好了'); done.type = 'button'; done.onclick = closeSheet;
    f.append(sum, el('span', 'sp'), done);
    sheet.append(h, body, f); root.appendChild(sheet);
  }
  function openSheet() {
    sheetOpen = true; hideChoices(); sheet.hidden = false;
    if (!sheetCat || !MD.CATS.some((c) => c.id === sheetCat)) sheetCat = MD.CATS[0].id;
    $('#npcShStore').textContent = storeLabel() ? '· ' + storeLabel() : (online() ? '· 离线演示菜单' : '');
    renderSheet();
    const t = sheet.querySelector('.sh-tab.on'); if (t) t.focus({ preventScroll: true });
  }
  function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false; sheet.hidden = true;
    const n = active().length;
    show(n ? `收到,一共 ${n} 件,后厨已经在做啦。还需要什么吗?` : '不点也没关系,想好了随时叫我。', rootChoices);
  }
  function renderSheet() {
    const tabs = $('#npcShTabs'), grid = $('#npcShGrid');
    tabs.replaceChildren(...MD.CATS.map((c) => {
      const b = el('button', 'sh-tab' + (c.id === sheetCat ? ' on' : '')); b.type = 'button';
      const im = el('img'); im.src = png(c.icon); im.alt = '';
      b.append(im, el('span', '', c.name)); b.setAttribute('aria-pressed', String(c.id === sheetCat));
      b.onclick = () => { sheetCat = c.id; renderSheet(); const n = sheet.querySelector('.sh-tab.on'); if (n) n.focus({ preventScroll: true }); };
      return b;
    }));
    grid.replaceChildren();
    cardRefs.clear();
    const items = sheetCat === 'combo' ? MD.COMBOS : MD.LIST.filter((p) => p.cat === sheetCat);
    if (!items.length) grid.append(el('p', 'sub', '这个分类暂时没有餐品'));
    items.forEach((p) => {
      const isCombo = sheetCat === 'combo', card = el('div', 'sh-card');
      const im = el('img'); im.src = png(p.sprite); im.alt = '';
      card.append(im, el('div', 'n', p.name), el('div', 'p', money(p.price)));
      if (isCombo) card.append(el('div', 'sub', p.items.map((i) => MD.P[i].name).join(' + ')));
      else if (p.approx) card.append(el('div', 'sub', '动画为近似效果'));
      const q = el('div', 'sh-qty'), minus = el('button', '', '−'), out = el('output', '', ''), plus = el('button', '', '+');
      minus.type = plus.type = 'button';
      minus.setAttribute('aria-label', '减少 ' + p.name); plus.setAttribute('aria-label', '增加 ' + p.name);
      plus.onclick = () => { isCombo ? p.items.forEach((i) => E.add(i)) : E.add(p.id); refreshSheet(); };
      minus.onclick = () => {
        if (isCombo || minus.getAttribute('aria-disabled') === 'true') return;
        const mine = active().filter((o) => o.pid === p.id); const o = mine[mine.length - 1];
        if (o) E.cancel(o); refreshSheet();
      };
      if (isCombo) q.append(plus); else q.append(minus, out, plus);
      card.append(q); grid.append(card); cardRefs.set(p.id, { card, out, minus });
    });
    refreshSheet();
  }
  function refreshSheet() {
    cardRefs.forEach((r, id) => {
      const n = qtyOf(id);
      r.out.value = n; r.card.classList.toggle('has', n > 0);
      r.minus.setAttribute('aria-disabled', String(n === 0));
    });
    const act = active();
    $('#npcShTotal').textContent = money(act.reduce((s, o) => s + o.def.price, 0));
    $('#npcShQuote').textContent = act.length ? `共 ${act.length} 件 · 结算价以右侧面板「结算」为准` : '还没有点单';
  }

  /* ---------- 进入 / 离开 ---------- */
  function seeds() {
    const host = $('.vn-seeds'); if (!host || reduce) return;
    for (let i = 0; i < 14; i++) {
      const s = el('i', 'vn-seed'), w = 8 + Math.random() * 8;
      s.style.cssText = `left:${Math.random() * 100}%;width:${w}px;height:${w * .5}px;animation-duration:${9 + Math.random() * 8}s;animation-delay:-${Math.random() * 14}s;` +
        `--dx:${(Math.random() - .5) * 120}px;--rot:${Math.random() * 360}deg`;
      host.append(s);
    }
  }
  function build() {
    root = el('div', 'npcvn'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '与店员小麦对话');
    root.innerHTML =
      '<div class="vn-bg"></div><div class="vn-tint"></div><div class="vn-seeds" aria-hidden="true"></div>' +
      '<div class="vn-top"><button class="vn-chip" type="button" id="npcBye">离开 (Esc)</button></div>' +
      '<div class="vn-portrait" aria-hidden="true"><img src="assets/npc/xiaomai.webp" alt="" draggable="false"></div>' +
      '<aside class="vn-plaque" aria-label="地点"><div class="vn-emblem" aria-hidden="true">M</div><div class="vn-cols"><div class="vn-title">点单台</div><div class="vn-loc" id="npcLoc"></div></div></aside>' +
      '<div class="vn-choices" id="npcChoices" role="group" aria-label="选项" hidden></div>' +
      '<div class="sr" id="npcSr" role="status" aria-live="polite"></div>' +
      '<div class="vn-box" id="npcBox" tabindex="0" aria-label="小麦说话,按回车或空格继续"><div class="vn-name"><i aria-hidden="true">M</i><span>小麦</span></div><div class="vn-text" id="npcText" aria-hidden="true"></div><span class="vn-next" aria-hidden="true"></span></div>';
    doc.body.appendChild(root);
    box = $('#npcBox'); textEl = $('#npcText'); srEl = $('#npcSr'); choicesEl = $('#npcChoices'); portrait = $('.vn-portrait'); locEl = $('#npcLoc');
    seeds(); buildSheet();
    $('#npcBye').onclick = leave;
    box.addEventListener('click', advance);
  }
  function enter() {
    if (open || !E) return;
    open = true; prevSpeed = E.speed; E.speed = 0;                 // 暂停后厨, 订单与动画原样保留
    prevFocus = doc.activeElement;
    locEl.textContent = '地点・' + (storeLabel() || '后厨点单台');
    root.classList.remove('out'); root.classList.add('open'); sheetOpen = false; sheet.hidden = true;
    doc.querySelectorAll('#app').forEach((a) => a.setAttribute('inert', ''));
    toRoot(); box.focus({ preventScroll: true });
  }
  function leave() {
    if (!open) return;
    clearInterval(typingTimer); typing = false; queue = []; pending = null; hideChoices();
    sheetOpen = false; sheet.hidden = true;
    root.classList.add('out');
    setTimeout(() => {
      root.classList.remove('open', 'out'); open = false;
      doc.querySelectorAll('#app').forEach((a) => a.removeAttribute('inert'));
      if (E) E.speed = prevSpeed || 1;
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    }, reduce ? 0 : 240);
  }

  /* ---------- 后厨画面上的提示与入口 ---------- */
  function placeTip() {
    if (!tip || !E) return;
    const cv = $('#cv'), st = $('#stage'); if (!cv || !st) return;
    const r = cv.getBoundingClientRect(), s = st.getBoundingClientRect(), w = E.worker, k = r.width / MD.W;
    const x = r.left - s.left + w.x * k, y = r.top - s.top + (w.y - 200 * MD.WS) * k;
    tip.style.left = Math.round(x + 46) + 'px'; tip.style.top = Math.round(y + 6) + 'px';
  }
  function setupEntry() {
    const st = $('#stage');
    tip = el('button', 'npc-tip'); tip.type = 'button'; tip.setAttribute('aria-label', '和店员小麦说话,快捷键 F');
    const k = el('span', 'npc-kbd', 'F'); tip.append(k, doc.createTextNode('和小麦说话'));
    tip.onclick = enter; st.appendChild(tip);
    const fab = el('button', 'npc-fab'); fab.type = 'button'; fab.setAttribute('aria-label', '和店员小麦说话,快捷键 F');
    fab.append(el('span', 'npc-kbd', 'F'), doc.createTextNode('找小麦聊聊')); fab.onclick = enter; st.appendChild(fab);
    // 点画面里的小人也能进入(canvas 坐标 -> 店员方框)
    const cv = $('#cv');
    cv.style.cursor = 'default';
    cv.addEventListener('click', (e) => {
      const r = cv.getBoundingClientRect(), k2 = MD.W / r.width, w = E.worker;
      const x = (e.clientX - r.left) * k2, y = (e.clientY - r.top) * k2;
      if (Math.abs(x - w.x) < 50 && y > w.y - 210 && y < w.y + 6) enter();
    });
    cv.addEventListener('mousemove', (e) => {
      const r = cv.getBoundingClientRect(), k2 = MD.W / r.width, w = E.worker;
      const x = (e.clientX - r.left) * k2, y = (e.clientY - r.top) * k2;
      cv.style.cursor = Math.abs(x - w.x) < 50 && y > w.y - 210 && y < w.y + 6 ? 'pointer' : 'default';
    });
    (function loop() { if (!open) placeTip(); requestAnimationFrame(loop); })();
  }

  /* ---------- 键盘 ---------- */
  function isTyping(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
  doc.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!open) {
      if ((e.key === 'f' || e.key === 'F') && !isTyping(e.target) && !e.repeat) {
        const modal = $('#storeModal');
        if (modal && modal.style.display === 'flex') return;       // 选门店弹窗开着时不抢键
        if (E) { e.preventDefault(); enter(); }
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); if (sheetOpen) closeSheet(); else leave(); return; }
    if (sheetOpen) return;
    if (/^[1-9]$/.test(e.key) && !choicesEl.hidden) {
      const b = choicesEl.children[+e.key - 1]; if (b) { e.preventDefault(); b.click(); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const bs = [...choicesEl.children]; if (!bs.length) return;
      e.preventDefault(); const i = bs.indexOf(doc.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
      return;
    }
    // 回车/空格: 对话框或空白处 = 继续; 焦点在按钮上时让按钮自己响应
    if ((e.key === 'Enter' || e.key === ' ') && (doc.activeElement === box || doc.activeElement === doc.body)) { e.preventDefault(); advance(); }
  });
  // 订单状态变化时, 点单面板的数量同步
  function hookEngine() { E.on(() => { if (open && sheetOpen) refreshSheet(); }); }

  function start() {
    E = MD.engine; if (!E) return;
    // 阻止 Tab 把焦点带出对话层
    build(); setupEntry(); hookEngine();
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...root.querySelectorAll('button:not([hidden]):not([disabled]),[tabindex="0"]')].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  MD.npc = { enter, leave };
  doc.addEventListener('md:ready', start);
})(window);
