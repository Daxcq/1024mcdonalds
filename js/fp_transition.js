/* fp_transition.js
 * 汉堡小游戏的转场：1024 程序员节 M-CODE 小票。
 *   FP.transition.play({ onCover, duration, title, caption, sound }) -> Promise<void>
 * 全程一张 canvas：暗色背景淡入 -> 小票滑入并打印 -> 代码汉堡逐层堆起来 + 进度条
 * -> 变成真汉堡 + 盖章 -> 小票撕走，背景像素块溶解。
 * 普通脚本，file:// 可用；FP.sfx 不存在时静音运行。 */
(function () {
  'use strict';
  const FP = (window.FP = window.FP || {});
  const T = (FP.transition = FP.transition || {});
  T.assetBase = T.assetBase || 'assets/fp/burger/';

  /* ---------- 常量 ---------- */
  const RW = 340, RH = 736, M = 26;             // 小票逻辑尺寸；缓存四周留 M 放阴影
  const PAPER = '#f6f3ea', INK = '#1c1915', BACK = '#1a0f08';
  const RED = '#da291c', YEL = '#ffbc0d';
  const CJK = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif';
  const MONO = 'Consolas,"Courier New","DejaVu Sans Mono",monospace';
  const BASE = 2800;                            // 时间轴按 2800ms 设计，其余时长等比缩放
  // 时间轴（ms，基于 BASE）：盖住 -> 打印 -> 逐层堆汉堡 -> 变真汉堡 -> 盖章 -> 撕走+溶解
  const TL = {
    cover: 450,                                 // 背景全黑，调用 onCover
    print0: 450, print1: 1050,                  // 小票从上往下打印
    asm: 900, layer: 130, drop: 300,            // 代码汉堡：第一层落下的时刻 / 层间隔 / 单层下落时长
    bar0: 1050, bar1: 1800,                     // 进度条 0% -> 100%
    flash: 1800, fade0: 1860, fade1: 2060,      // 100% 闪一下 -> 渐变成真汉堡
    stamp: 2060, tear: 2300, melt: 2340,        // READY 盖章 -> 小票撕走 -> 背景像素溶解
  };
  const BLOCK = 24;                             // 像素溶解方块边长（CSS px）

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const easeIn = (k) => k * k * k;
  const easeBack = (k) => 1 + 2.9 * Math.pow(k - 1, 3) + 1.9 * Math.pow(k - 1, 2);
  function rng(seed) {                          // mulberry32：同一个 seed 画出同样的二进制/条码
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  function rr(c, x, y, w, h, r) {               // 圆角矩形路径；r 可以是 [左上,右上,右下,左下]
    const q = Array.isArray(r) ? r : [r, r, r, r];
    c.beginPath(); c.moveTo(x + q[0], y);
    c.lineTo(x + w - q[1], y); c.arcTo(x + w, y, x + w, y + q[1], q[1]);
    c.lineTo(x + w, y + h - q[2]); c.arcTo(x + w, y + h, x + w - q[2], y + h, q[2]);
    c.lineTo(x + q[3], y + h); c.arcTo(x, y + h, x, y + h - q[3], q[3]);
    c.lineTo(x, y + q[0]); c.arcTo(x, y, x + q[0], y, q[0]); c.closePath();
  }
  const sfx = (st, name, o) => { if (st.opts.sound === false) return; try { if (FP.sfx && FP.sfx.play) FP.sfx.play(name, o); } catch (e) { /* 静音继续 */ } };

  /* ---------- 真汉堡贴图：每次随机一张 B01..B20，提前加载 ---------- */
  const POOL = [];
  for (let i = 1; i <= 20; i++) POOL.push('B' + (i < 10 ? '0' : '') + i);
  let nextSpr = null;
  function prepSprite() {
    const s = { key: POOL[(Math.random() * POOL.length) | 0], base: T.assetBase, img: new Image(), ok: false };
    s.img.onload = () => { s.ok = s.img.naturalWidth > 0; };
    s.img.onerror = () => { s.ok = false; };       // 加载失败：跳过“变真汉堡”这一拍，不报错
    s.img.src = s.base + s.key + '.png';
    nextSpr = s;
  }
  T.preload = function () { if (!nextSpr || nextSpr.base !== T.assetBase) prepSprite(); };

  /* ---------- 播放状态 ---------- */
  let cur = null;                                   // 正在播放的那一次；play() 重入时直接返回它的 promise
  function layout(st) {                             // 首次 + 窗口尺寸 / 像素比变化时重算
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    st.dpr = dpr; st.W = st.cv.clientWidth || window.innerWidth; st.H = st.cv.clientHeight || window.innerHeight;
    st.cv.width = Math.max(1, Math.round(st.W * dpr)); st.cv.height = Math.max(1, Math.round(st.H * dpr));
    // 背景缓存：深棕底 + 中间偏暖的暗角
    const b = mkCanvas(st.cv.width, st.cv.height), c = b.getContext('2d');
    c.fillStyle = BACK; c.fillRect(0, 0, b.width, b.height);
    const cx = b.width / 2, cy = b.height * 0.46, g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(b.width, b.height) * 0.62);
    g.addColorStop(0, 'rgba(120,52,16,0.55)'); g.addColorStop(0.55, 'rgba(60,24,8,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = g; c.fillRect(0, 0, b.width, b.height);
    st.bg = b;
    // 像素溶解：每个方块一个 0..1 的阈值（左下 -> 右上的对角波 + 随机抖动），只算一次
    const bs = Math.max(8, Math.round(BLOCK * dpr));
    st.bs = bs; st.cols = Math.ceil(b.width / bs); st.rows = Math.ceil(b.height / bs);
    const r = rng(1024), th = new Float32Array(st.cols * st.rows);
    for (let y = 0; y < st.rows; y++) {
      for (let x = 0; x < st.cols; x++) th[y * st.cols + x] = clamp(((x / st.cols) * 0.6 + (1 - y / st.rows) * 0.4) * 0.72 + r() * 0.28, 0, 1);
    }
    st.th = th;
    layoutReceipt(st);
  }
  function layoutReceipt(st) {                      // 小票占视口高度约 88%，窄屏下不超过 92% 宽
    st.rs = clamp(Math.min(st.H * 0.88 / RH, st.W * 0.92 / RW), 0.45, 1.7);
    paintStatic(st); paintBurger(st);
  }

  function drawBackdrop(st, t) {
    const c = st.cx;
    if (t < TL.melt) {                              // 淡入到全黑（onCover 之前不会露出下面的场景切换）
      c.globalAlpha = easeOut(prog(t, 0, TL.cover)); c.drawImage(st.bg, 0, 0); c.globalAlpha = 1; return;
    }
    const m = prog(t, TL.melt, BASE) * 1.001, cols = st.cols, th = st.th, bs = st.bs;
    c.save(); c.beginPath();                        // 阈值 >= m 的方块还在，其余已经溶掉
    for (let y = 0; y < st.rows; y++) for (let x = 0; x < cols; x++) if (th[y * cols + x] >= m) c.rect(x * bs, y * bs, bs, bs);
    c.clip(); c.drawImage(st.bg, 0, 0); c.restore();
  }
  /* ---------- 渲染一帧 / 收尾 / 入口 ---------- */
  function render(st, t) {
    const c = st.cx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, st.cv.width, st.cv.height);
    drawBackdrop(st, t);
    if (t < TL.tear + 520) drawReceipt(st, t);
  }
  function safe(fn) { try { if (typeof fn === 'function') fn(); } catch (e) { if (window.console) console.error(e); } }

  function finish(st) {
    if (st.done) return;
    st.done = true;
    cancelAnimationFrame(st.raf); clearTimeout(st.safety);
    window.removeEventListener('resize', st.onResize);
    if (!st.covered) { st.covered = true; safe(st.opts.onCover); }   // 页面在后台被冻结时也别漏掉切场景
    if (st.cv.parentNode) st.cv.parentNode.removeChild(st.cv);
    cur = null;
    setTimeout(prepSprite, 0);                      // 为下一次预先抽好、加载好汉堡贴图
    st.resolve();
  }
  function frame(st, now) {
    if (st.done) return;
    const t = Math.max(0, (now - st.t0) / st.k);
    if (!st.covered && t >= TL.cover) { st.covered = true; safe(st.opts.onCover); }
    render(st, t);
    if (t >= BASE) { finish(st); return; }
    st.raf = requestAnimationFrame((n) => frame(st, n));
  }

  T.play = function (opts) {
    if (cur) return cur.promise;
    opts = Object.assign({}, opts || {});
    const dur = clamp(+opts.duration || BASE, 800, 15000);
    const st = { opts, dur, k: dur / BASE, covered: false, done: false, fired: {}, cv: document.createElement('canvas') };
    st.title = opts.title != null ? String(opts.title) : "1024 PROGRAMMER'S DAY";
    st.caption = opts.caption != null ? String(opts.caption) : '已成功连接到美味服务器: mcd.cn';
    st.promise = new Promise((res) => { st.resolve = res; });
    cur = st;
    T.preload(); st.spr = nextSpr;
    st.cv.setAttribute('aria-hidden', 'true');
    st.cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:1000;pointer-events:auto;touch-action:none;';
    document.body.appendChild(st.cv);
    st.cx = st.cv.getContext('2d');
    layout(st);
    st.onResize = () => { if (!st.done) layout(st); };
    window.addEventListener('resize', st.onResize);
    st.safety = setTimeout(() => finish(st), dur + 2500);      // 标签页在后台时 rAF 会停，兜底保证一定 resolve
    st.t0 = performance.now();
    st.raf = requestAnimationFrame((n) => frame(st, n));
    return st.promise;
  };
  /* 页面一加载就开始抽签 + 加载贴图，第一次播放时它大概率已经就位 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => T.preload(), { once: true });
  else T.preload();
  /* ---------- 5x7 点阵字库（小票上的标题、LOADING、READY 都用它画） ---------- */
  const GLYPH = {
    A: '.###./#...#/#...#/#####/#...#/#...#/#...#', B: '####./#...#/#...#/####./#...#/#...#/####.',
    C: '.###./#...#/#..../#..../#..../#...#/.###.', D: '####./#...#/#...#/#...#/#...#/#...#/####.',
    E: '#####/#..../#..../####./#..../#..../#####', F: '#####/#..../#..../####./#..../#..../#....',
    G: '.###./#...#/#..../#.###/#...#/#...#/.###.', H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
    I: '.###./..#../..#../..#../..#../..#../.###.', J: '..###/...#./...#./...#./...#./#..#./.##..',
    K: '#...#/#..#./#.#../##.../#.#../#..#./#...#', L: '#..../#..../#..../#..../#..../#..../#####',
    M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
    O: '.###./#...#/#...#/#...#/#...#/#...#/.###.', P: '####./#...#/#...#/####./#..../#..../#....',
    Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', R: '####./#...#/#...#/####./#.#../#..#./#...#',
    S: '.####/#..../#..../.###./....#/....#/####.', T: '#####/..#../..#../..#../..#../..#../..#..',
    U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.', V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
    W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#', X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
    Y: '#...#/#...#/.#.#./..#../..#../..#../..#..', Z: '#####/....#/...#./..#../.#.../#..../#####',
    0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.', 1: '..#../.##../..#../..#../..#../..#../.###.',
    2: '.###./#...#/....#/...#./..#../.#.../#####', 3: '#####/...#./..#../...#./....#/#...#/.###.',
    4: '...#./..##./.#.#./#..#./#####/...#./...#.', 5: '#####/#..../####./....#/....#/#...#/.###.',
    6: '..##./.#.../#..../####./#...#/#...#/.###.', 7: '#####/....#/...#./..#../.#.../.#.../.#...',
    8: '.###./#...#/#...#/.###./#...#/#...#/.###.', 9: '.###./#...#/#...#/.####/....#/...#./.##..',
    '-': '...../...../...../#####/...../...../.....', "'": '..#../..#../.#.../...../...../...../.....',
    '%': '##..#/##.#./...#./..#../.#.../.#.##/#..##', '+': '...../..#../..#../#####/..#../..#../.....',
    '.': '...../...../...../...../...../.##../.##..', ' ': '...../...../...../...../...../...../.....',
  };
  const GBITS = {};                                 // 'A' -> [14,17,17,31,...]（7 行，每行 5 位）
  function glyphRows(ch) {
    ch = ch.toUpperCase();
    if (!GBITS[ch]) {
      const g = GLYPH[ch] || GLYPH[' '];
      GBITS[ch] = g.split('/').map((r) => { let v = 0; for (let i = 0; i < 5; i++) v = (v << 1) | (r[i] === '#' ? 1 : 0); return v; });
    }
    return GBITS[ch];
  }
  /* ---------- 点阵文字：dot 为单点边长，gap 为点间距；返回占用宽度 ---------- */
  function dotText(c, str, x, y, dot, gap, fill, align) {
    const step = dot + gap, adv = 6 * step;          // 每个字 5 列 + 1 列字间距
    const w = str.length * adv - step;
    let ox = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    c.fillStyle = fill;
    for (let i = 0; i < str.length; i++, ox += adv) {
      const rows = glyphRows(str[i]);
      for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (rows[r] & (16 >> k)) c.fillRect(ox + k * step, y + r * step, dot, dot);
    }
    return w;
  }
  /* M-CODE 大标题：每个点是一个方块，右下角叠一层阶梯阴影（和照片里一样的立体感） */
  function bigTitle(c, str, cx, y, dot, gap) {
    const step = dot + gap, w = str.length * 6 * step - step, x0 = cx - w / 2;
    c.fillStyle = 'rgba(28,25,21,0.28)';
    for (let i = 0; i < str.length; i++) {
      const rows = glyphRows(str[i]), ox = x0 + i * 6 * step;
      for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (rows[r] & (16 >> k)) c.fillRect(ox + k * step + 2, y + r * step + 2, dot, dot);
    }
    dotText(c, str, x0, y, dot, gap, INK, 'left');
  }

  /* ---------- 小票静态部分：只画一次，放进缓存 ---------- */
  function paintStatic(st) {
    const sc = st.rs * st.dpr, cv = mkCanvas((RW + M * 2) * sc, (RH + M * 2) * sc);
    let c = cv.getContext('2d');
    c.scale(sc, sc); c.translate(M, M);
    // 纸张：柔和阴影 + 上下边缘的锯齿（热敏纸撕口）
    c.save(); c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 16; c.shadowOffsetY = 6;
    c.fillStyle = PAPER; c.beginPath(); c.moveTo(0, 0);
    for (let x = 0; x <= RW; x += 8) c.lineTo(x, (x / 8) % 2 ? 0 : 5);
    c.lineTo(RW, RH - 5);
    for (let x = RW; x >= 0; x -= 8) c.lineTo(x, RH - ((x / 8) % 2 ? 0 : 5));
    c.closePath(); c.fill(); c.restore();
    const g = c.createLinearGradient(0, 0, RW, 0);   // 纸面的淡淡明暗
    g.addColorStop(0, 'rgba(0,0,0,0.05)'); g.addColorStop(0.3, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.07)');
    c.fillStyle = g; c.fillRect(0, 6, RW, RH - 12);
    st.paper = cv;                                   // 空白纸张；油墨单独一张图，打印时从上往下露出
    const ink = mkCanvas(cv.width, cv.height);
    c = ink.getContext('2d'); c.scale(sc, sc); c.translate(M, M);
    c.fillStyle = INK; c.textBaseline = 'alphabetic';
    // 1. 小标题 + 2. M-CODE
    const tl = st.title.toUpperCase().slice(0, 28), ts = Math.min(2.4, (RW - 28) / (tl.length * 6 - 1));
    dotText(c, tl, RW / 2, 18, ts * 0.68, ts * 0.32, INK, 'center');
    bigTitle(c, 'M-CODE', RW / 2, 44, 7, 2);
    // 3. 圆角外框：左上 + + +，右上 FROM BIT TO BITE，四角小括号
    const fx = 22, fy = 128, fw = RW - 44, fh = 362;
    c.lineWidth = 2; c.strokeStyle = INK; rr(c, fx, fy, fw, fh, 14); c.stroke();
    c.lineWidth = 1; c.setLineDash([2, 3]); rr(c, fx + 4, fy + 4, fw - 8, fh - 8, 11); c.stroke(); c.setLineDash([]);
    c.lineWidth = 2; c.beginPath(); c.moveTo(fx + 4, fy + 24); c.lineTo(fx + fw - 4, fy + 24); c.stroke();
    c.font = 'bold 15px ' + MONO; c.fillText('+ + +', fx + 14, fy + 19);
    dotText(c, 'FROM BIT TO BITE', fx + fw - 12, fy + 6, 1.5, 0.7, INK, 'right');
    c.lineWidth = 2.4; const br = (x, y, dx, dy) => { c.beginPath(); c.moveTo(x + dx * 9, y); c.lineTo(x, y); c.lineTo(x, y + dy * 9); c.stroke(); };
    br(fx + 14, fy + 38, 1, 1); br(fx + fw - 14, fy + 38, -1, 1); br(fx + 14, fy + fh - 14, 1, -1); br(fx + fw - 14, fy + fh - 14, -1, -1);
    st.frame = { x: fx, y: fy, w: fw, h: fh };
    // 4. 虚线气泡框：挨着外框下沿，左边有个小尖角
    const bx = 14, by = fy + fh + 14, bw = RW - 28, bh = 34;
    c.lineWidth = 1.2; c.setLineDash([3, 3]); rr(c, bx, by, bw, bh, 6); c.stroke(); c.setLineDash([]);
    c.fillStyle = PAPER; c.beginPath(); c.moveTo(bx + 34, by - 1); c.lineTo(bx + 52, by - 15); c.lineTo(bx + 70, by - 1); c.closePath(); c.fill();
    c.setLineDash([3, 3]); c.beginPath(); c.moveTo(bx + 34, by); c.lineTo(bx + 52, by - 15); c.lineTo(bx + 70, by); c.stroke(); c.setLineDash([]);
    c.fillStyle = INK; c.font = '10px ' + CJK;
    c.fillText('本次转场由 100% 纯手工二进制烤制，请放心食用。', bx + 10, by + 15);
    c.fillText('如遇卡顿，属于热敏纸正常打印现象。', bx + 10, by + 28);
    // 5. 产品详情表
    let y = by + bh + 26;
    c.font = 'bold 12px ' + CJK; c.fillText('> 产品详情', 16, y); y += 20;
    c.font = 'bold 11px ' + CJK; c.fillText('数量', 16, y); c.fillText('产品', 66, y); c.textAlign = 'right'; c.fillText('价格', RW - 16, y); c.textAlign = 'left';
    c.font = '12px ' + CJK; y += 18;
    ['代码没有Bug', '调试顺利通过', '需求没有变更'].forEach((s) => {
      c.fillText('1', 22, y); c.fillText(s, 66, y);
      c.font = '12px ' + MONO; c.textAlign = 'right'; c.fillText('free', RW - 16, y); c.textAlign = 'left'; c.font = '12px ' + CJK; y += 18;
    });
    y += 2; c.fillStyle = INK; for (let x = 14; x < RW - 14; x += 5) c.fillRect(x, y, 2, 1.4);   // 点线分隔
    const mm = /^(.*?)\s*(mcd\.cn)\s*$/i.exec(st.caption), l1 = mm ? mm[1] : st.caption;   // “…服务器: mcd.cn” 拆成两行
    y += 22; c.font = 'bold 13px ' + CJK;
    const mw = c.measureText(l1).width;              // 自定义文案太长时缩小字号，别冲出纸边
    if (mw > RW - 32) c.font = 'bold ' + Math.max(8, Math.floor(13 * (RW - 32) / mw)) + 'px ' + CJK;
    c.fillText(l1, 16, y);
    y += 20; c.font = '12px ' + MONO; c.fillText('mcd.cn', RW / 2 - 18, y);
    st.ink = ink;
  }

  /* ---------- 画一帧小票：滑入 -> 打印 -> 撕走。动态内容在小票自己的坐标系里画 ---------- */
  function once(st, key, t, at, fn) { if (t >= at && !st.fired[key]) { st.fired[key] = true; fn(); } }
  function drawReceipt(st, t) {
    if (!st.ink) return;
    const c = st.cx, dpr = st.dpr, sc = st.rs * dpr;
    once(st, 'whoosh0', t, 0, () => sfx(st, 'whoosh', { dir: 'in' }));
    once(st, 'print', t, TL.print0, () => sfx(st, 'print', { dur: (TL.print1 - TL.print0) * st.k }));
    once(st, 'whoosh1', t, TL.tear, () => sfx(st, 'whoosh', { dir: 'out' }));
    const pr = prog(t, TL.print0, TL.print1), printing = pr > 0 && pr < 1;
    const slide = 1 - easeOut(prog(t, 0, TL.cover));                     // 1 -> 0：从屏幕下方升上来
    const tear = easeIn(prog(t, TL.tear, TL.tear + 480));                // 0 -> 1：向上撕走
    const hit = t >= TL.stamp ? Math.exp(-(t - TL.stamp) / 70) : 0;      // 盖章瞬间的震动，快速衰减
    const rise = (st.H / 2 + RH * st.rs / 2 + 30);
    let cx = st.W / 2 + Math.sin(t * 0.09) * 0.6 * (printing ? 1 : 0) + Math.sin(t * 0.7) * 2.2 * hit;
    let cy = st.H / 2 + slide * rise - tear * rise * 1.05 + (printing ? Math.sin(t * 0.13) * 0.7 : 0) + hit * 3;
    const rot = -0.052 + tear * -0.07 + Math.sin(t * 0.5) * 0.004 * hit;
    c.save();
    c.setTransform(1, 0, 0, 1, cx * dpr, cy * dpr); c.rotate(rot);
    const ox = -(RW / 2 + M) * sc, oy = -(RH / 2 + M) * sc;
    c.drawImage(st.paper, ox, oy);                                       // 空白纸
    const srcH = Math.min(st.ink.height, Math.ceil((M + pr * RH) * sc));  // 油墨按打印进度从上往下露出
    if (srcH > 0) c.drawImage(st.ink, 0, 0, st.ink.width, srcH, ox, oy, st.ink.width, srcH);
    c.scale(sc, sc); c.translate(-RW / 2, -RH / 2);                      // 之后是小票坐标 (0..RW, 0..RH)
    if (printing) { c.fillStyle = 'rgba(28,25,21,0.55)'; c.fillRect(0, pr * RH - 1, RW, 2); }
    drawLive(st, c, t, pr);
    c.restore();
  }
  /* ---------- 代码汉堡：几何（小票坐标）与每层缓存 ---------- */
  // 从上到下：上层面包(圆顶，二进制) / 芝士(虚线) / 生菜(花括号波浪) / 肉饼(条形码) / 条码字符串 / 下层面包(二进制)
  const BG = { cx: RW / 2, hw: 114, bunT: [182, 270], cheese: [277, 289], lettuce: [289, 303], patty: [303, 349], code: 358, bunB: [369, 409] };
  const BAR_COL = [];                               // 进度条 21 格：红 -> 黄，只算一次
  for (let i = 0; i < 21; i++) { const k = i / 20; BAR_COL.push('rgb(' + Math.round(lerp(218, 255, k)) + ',' + Math.round(lerp(41, 188, k)) + ',' + Math.round(lerp(28, 13, k)) + ')'); }
  function bounce(k) {                              // easeOutBounce：落下时轻轻弹一下
    const n = 7.5625, d = 2.75;
    if (k < 1 / d) return n * k * k;
    if (k < 2 / d) { k -= 1.5 / d; return n * k * k + 0.75; }
    if (k < 2.5 / d) { k -= 2.25 / d; return n * k * k + 0.9375; }
    k -= 2.625 / d; return n * k * k + 0.984375;
  }
  function layerCanvas(st, x, y, w, h) {            // 小票坐标 (x,y,w,h) -> 按显示像素渲染的缓存
    const sc = st.rs * st.dpr, cv = mkCanvas(w * sc, h * sc), c = cv.getContext('2d');
    c.scale(sc, sc); c.translate(-x, -y);
    return { cv, c, x, y, w, h };
  }
  function binaryFill(c, r, x0, y0, x1, y1, px, py) {   // 在 clip 里铺满 0/1，每个字符定位绘制，不依赖字体宽度
    c.font = 'bold 9px ' + MONO; c.fillStyle = INK; c.textBaseline = 'middle'; c.textAlign = 'center';
    for (let y = y0; y < y1; y += py) for (let x = x0; x < x1; x += px) c.fillText(r() < 0.5 ? '0' : '1', x, y);
  }
  function domePath(c, cx, base, hw, h) {           // 圆顶：三次贝塞尔拱形 + 带圆角的平底
    c.beginPath(); c.moveTo(cx - hw, base);
    c.bezierCurveTo(cx - hw, base - h * 1.28, cx + hw, base - h * 1.28, cx + hw, base);
    c.quadraticCurveTo(cx + hw - 3, base + 6, cx + hw - 14, base + 6); c.lineTo(cx - hw + 14, base + 6);
    c.quadraticCurveTo(cx - hw + 3, base + 6, cx - hw, base); c.closePath();
  }
  function slabPath(c, cx, y0, y1, hw) {            // 下层面包：上沿微鼓，底部平直圆角
    c.beginPath(); c.moveTo(cx - hw, y0 + 6); c.quadraticCurveTo(cx, y0 - 6, cx + hw, y0 + 6);
    c.lineTo(cx + hw, y1 - 12); c.quadraticCurveTo(cx + hw, y1, cx + hw - 12, y1);
    c.lineTo(cx - hw + 12, y1); c.quadraticCurveTo(cx - hw, y1, cx - hw, y1 - 12); c.closePath();
  }
  function paintBurger(st) {
    const L = [], cx = BG.cx, hw = BG.hw, r = rng(0xBEEF);
    const add = (name, y0, y1, pad) => { const l = layerCanvas(st, cx - hw - pad, y0, hw * 2 + pad * 2, y1 - y0); l.name = name; L.push(l); return l; };
    // 下层面包：二进制铺满平底圆角板
    let l = add('bunB', BG.bunB[0] - 8, BG.bunB[1] + 4, 4);
    l.c.save(); slabPath(l.c, cx, BG.bunB[0], BG.bunB[1], hw); l.c.clip();
    binaryFill(l.c, r, cx - hw, BG.bunB[0] - 6, cx + hw, BG.bunB[1] + 8, 7.4, 9.6); l.c.restore();
    l.c.lineWidth = 2.2; l.c.strokeStyle = INK; slabPath(l.c, cx, BG.bunB[0], BG.bunB[1], hw); l.c.stroke();
    // 肉饼：条形码，宽窄不一的竖条；下面一行小字符串（照片里的 MC055401507265918 0021）
    l = add('patty', BG.patty[0] - 2, BG.code + 8, 4);
    const rb = rng(1024), bh = BG.patty[1] - BG.patty[0];
    for (let x = cx - hw + 2; x < cx + hw - 2;) {
      const w = 1 + ((rb() * 3.4) | 0) * 0.9, bar = rb() < 0.62;
      if (bar) { l.c.fillStyle = INK; l.c.fillRect(x, BG.patty[0], w, bh); }
      x += w + (rb() < 0.5 ? 1 : 1.8);
    }
    l.c.font = '8px ' + MONO; l.c.fillStyle = INK; l.c.textAlign = 'center'; l.c.textBaseline = 'middle';
    l.c.fillText('MC055401507265918 0021', cx, BG.code);
    // 生菜：一排起伏的花括号 / 尖括号
    l = add('lettuce', BG.lettuce[0] - 4, BG.lettuce[1] + 6, 6);
    l.c.font = 'bold 12px ' + MONO; l.c.fillStyle = INK; l.c.textAlign = 'center'; l.c.textBaseline = 'middle';
    const sym = ['{', '}', '<', '>', '{', '}', '~'];
    for (let x = cx - hw + 2, i = 0; x < cx + hw; x += 7.6, i++) l.c.fillText(sym[(i * 3 + (i >> 2)) % sym.length], x, BG.lettuce[0] + 8 + Math.sin(i * 1.15) * 3);
    // 芝士：一行虚线，两端略收，中间下垂一个小三角（融化的感觉）
    l = add('cheese', BG.cheese[0] - 2, BG.cheese[1] + 8, 6);
    l.c.fillStyle = INK; for (let x = cx - hw - 4; x < cx + hw + 4; x += 7) l.c.fillRect(x, BG.cheese[0] + 4, 4.5, 2.4);
    l.c.beginPath(); l.c.moveTo(cx - 12, BG.cheese[0] + 7); l.c.lineTo(cx, BG.cheese[1] + 5); l.c.lineTo(cx + 12, BG.cheese[0] + 7); l.c.closePath(); l.c.fill();
    // 上层面包：二进制铺满圆顶，再描边；右上角留几处“芝麻”高亮（空白点）
    l = add('bunT', BG.bunT[0] - 14, BG.bunT[1] + 8, 4);
    const base = BG.bunT[1];
    l.c.save(); domePath(l.c, cx, base, hw, base - BG.bunT[0]); l.c.clip();
    binaryFill(l.c, r, cx - hw, BG.bunT[0] - 6, cx + hw, base + 8, 7.4, 9.6); l.c.restore();
    l.c.lineWidth = 2.2; l.c.strokeStyle = INK; domePath(l.c, cx, base, hw, base - BG.bunT[0]); l.c.stroke();
    st.layers = L;                                   // 顺序：下面包、肉饼、生菜、芝士、上面包（也是堆叠顺序）
  }
  /* ---------- 动态部分：堆叠的代码汉堡 / 真汉堡 / 进度条 / 盖章（c 已在小票坐标系） ---------- */
  function drawLive(st, c, t, pr) {
    c.save();
    if (pr < 1) { c.beginPath(); c.rect(-8, -8, RW + 16, pr * RH + 8); c.clip(); }   // 还没打印到的地方不画动态内容
    const f = easeOut(prog(t, TL.fade0, TL.fade1)), real = !!(st.spr && st.spr.ok), gl = prog(t, TL.flash, TL.flash + 170);
    if (gl > 0 && gl < 1) {                          // 100% 时汉堡背后闪一团暖光
      const g = c.createRadialGradient(BG.cx, 292, 10, BG.cx, 292, 150), a = Math.sin(gl * Math.PI) * 0.75;
      g.addColorStop(0, 'rgba(255,188,13,' + a.toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,188,13,0)');
      c.fillStyle = g; c.fillRect(BG.cx - 160, 140, 320, 300);
    }
    const a0 = real ? 1 - f : 1, L = st.layers;
    if (a0 > 0.003 && L) {
      for (let i = 0; i < L.length; i++) {
        const l = L[i], ts = TL.asm + i * TL.layer, k = prog(t, ts, ts + TL.drop);
        if (k <= 0) continue;
        once(st, 'beep' + i, t, ts, () => sfx(st, 'beep', { i }));
        c.globalAlpha = a0 * clamp(k * 5, 0, 1);
        if (l.name === 'patty') {                    // 条形码：竖条从中线长高，同时像扫描仪一样从左扫到右
          const sy = lerp(0.15, 1, easeOut(k)), my = (BG.patty[0] + BG.patty[1]) / 2, sw = easeOut(prog(t, ts, ts + TL.drop * 1.7));
          c.save(); c.beginPath(); c.rect(l.x - 2, l.y - 4, (l.w + 4) * sw, l.h + 8); c.clip();
          c.translate(0, my); c.scale(1, sy); c.translate(0, -my); c.drawImage(l.cv, l.x, l.y, l.w, l.h); c.restore();
        } else c.drawImage(l.cv, l.x, l.y - (1 - bounce(k)) * 84, l.w, l.h);
      }
      c.globalAlpha = 1;
    }
    if (real && f > 0.003) {                         // FROM BIT TO BITE：代码汉堡渐变成真汉堡，带一点弹性放大
      const im = st.spr.img, s = Math.min(262 / im.naturalWidth, 236 / im.naturalHeight);
      const pop = 0.86 + 0.14 * easeBack(prog(t, TL.fade0, TL.fade1 + 160)), w = im.naturalWidth * s * pop, h = im.naturalHeight * s * pop;
      c.globalAlpha = f; c.drawImage(im, BG.cx - w / 2, 294 - h / 2, w, h); c.globalAlpha = 1;
    }
    drawBar(st, c, t);
    drawStamp(st, c, t);
    c.restore();
  }
  /* 进度条：21 格粗像素块，红 -> 黄；上方 "LOADING" 点阵字 + 百分比 */
  function drawBar(st, c, t) {
    const k = prog(t, TL.bar0, TL.bar1), p = lerp(k, easeOut(k), 0.3), pct = Math.round(p * 100), n = Math.round(p * 21);   // 接近匀速，开头略快
    const x0 = 44, y0 = 446, bw = RW - 88, cell = bw / 21;
    c.fillStyle = 'rgba(28,25,21,0.14)'; c.fillRect(x0 - 4, y0 - 4, bw + 8, 20);
    c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(x0 - 4, y0 - 4, bw + 8, 20);
    for (let i = 0; i < n; i++) { c.fillStyle = BAR_COL[i]; c.fillRect(x0 + i * cell + 1, y0, cell - 2, 12); }
    if (t < TL.bar0 - 120) return;
    dotText(c, 'LOADING', x0, y0 - 27, 2, 0.8, INK, 'left');   // “READY” 留给盖章；文字底边在条框上沿之上
    dotText(c, pct + '%', x0 + bw, y0 - 27, 2, 0.8, INK, 'right');
  }

  /* 盖章：红色 READY ✓ 从大到小砸下来，落下瞬间有一圈墨点飞溅 */
  function drawStamp(st, c, t) {
    const k = prog(t, TL.stamp, TL.stamp + 140);
    if (k <= 0) return;
    once(st, 'stamp', t, TL.stamp + 90, () => sfx(st, 'stamp'));   // 声音对齐“砸到纸上”那一帧
    const s = lerp(2.3, 0.84, easeIn(k)), a = clamp(k * 3, 0, 1);   // 落在汉堡下半部，露出上面的汉堡顶
    c.save(); c.translate(BG.cx + 46, 386); c.rotate(-0.16); c.scale(s, s); c.globalAlpha = a * 0.95;
    rr(c, -86, -26, 172, 52, 8); c.fillStyle = PAPER; c.fill();         // 奶白底：盖在汉堡贴图上也看得清
    c.strokeStyle = RED; c.fillStyle = RED; c.lineWidth = 4; c.stroke();
    c.lineWidth = 1.6; rr(c, -81, -21, 162, 42, 5); c.stroke();
    dotText(c, 'READY', -74, -13, 3, 1, RED, 'left');
    c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();   // ✓ 用路径画，字体里没有这个字也不会掉
    c.moveTo(48, 1); c.lineTo(56, 10); c.lineTo(72, -10); c.stroke();
    if (k >= 1) {                                    // 墨点：用固定种子，每次盖章飞溅图案一致
      const rs = rng(77); c.globalAlpha = Math.max(0, 0.8 - (t - TL.stamp - 140) / 260);
      for (let i = 0; i < 16; i++) { const an = rs() * 6.283, d = 92 + rs() * 22; c.fillRect(Math.cos(an) * d * 1.05 - 1, Math.sin(an) * d * 0.42 - 1, 2.4, 2.4); }
    }
    c.restore();
  }
})();
