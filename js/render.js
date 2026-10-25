/* 渲染层：Canvas 2D，逻辑分辨率 868x1049，对应 assets/kitchen_bg.png */
(function (g) {
  const MD = g.MD;
  const IMG = {};
  MD.loadImages = function () {
    const keys = Object.keys(g.MD_SPR || {}), jobs = [];
    const load = (k, src) => new Promise((res) => {
      const im = new Image(); im.onload = () => { IMG[k] = im; res(); }; im.onerror = () => res(); im.src = src;
    });
    keys.forEach((k) => jobs.push(load(k, 'assets/sprites/' + k + '.png')));
    ['_bg:assets/kitchen_bg.png', '_worker:assets/sprites/worker.png'].forEach((s) => { const [k, v] = s.split(':'); jobs.push(load(k, v)); });
    return Promise.all(jobs);
  };
  MD.IMG = IMG;

  function spr(c, key, x, y, w, o) {
    const im = IMG[key]; if (!im) return;
    o = o || {};
    const sc = o.scale === undefined ? 1 : o.scale, ww = w * sc, hh = ww * im.height / im.width;
    c.save();
    c.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * (c.globalAlpha || 1);
    c.translate(x, y);
    if (o.rot) c.rotate(o.rot);
    c.drawImage(im, -ww / 2, -hh + (o.below || 0), ww, hh);
    c.restore();
  }
  MD.spr = spr;

  /* 影子 */
  function shadow(c, x, y, rx, a) {
    c.save(); c.globalAlpha = a === undefined ? 0.25 : a; c.fillStyle = '#3a2a1a';
    c.beginPath(); c.ellipse(x, y, rx, rx * 0.35, 0, 0, Math.PI * 2); c.fill(); c.restore();
  }

  /* ---------- 道具 ---------- */
  function drawProp(c, p) {
    if (p.hidden) return;
    const a = p.alpha === undefined ? 1 : p.alpha;
    c.save(); c.globalAlpha = a;
    if (p.type === 'spr') {
      if (!p.held) shadow(c, p.x, p.y, (p.w || 40) * (p.scale || 1) * 0.35, 0.18 * a);
      spr(c, p.key, p.x + (p.dx || 0), p.y, p.w, { scale: p.scale, rot: p.rot });
    } else if (p.type === 'fill') {
      // 空容器（灰）+ 逐渐显现的成品（按 level 裁切）
      const im = IMG[p.key]; if (im) {
        const sc = p.scale === undefined ? 1 : p.scale, ww = p.w * sc, hh = ww * im.height / im.width, x = p.x + (p.dx || 0);
        if (!p.held) shadow(c, p.x, p.y, ww * 0.38, 0.2);
        c.save(); c.translate(x, p.y); if (p.rot) c.rotate(p.rot);
        const gh = IMG[p.key + '_ghost'];
        c.globalAlpha = a * 0.55; c.drawImage(im, -ww / 2, -hh, ww, hh); // 底：整图淡显（作为“空杯”轮廓）
        c.globalAlpha = a;
        const lv = Math.max(0, Math.min(1, p.level || 0)), cut = hh * (1 - lv);
        if (lv > 0) {
          c.beginPath(); c.rect(-ww / 2 - 2, -hh + cut, ww + 4, hh - cut + 2); c.clip();
          c.drawImage(im, -ww / 2, -hh, ww, hh);
        }
        c.restore();
      }
    } else if (p.type === 'burger') {
      drawBurger(c, p);
    }
    c.restore();
  }

  function drawBurger(c, p) {
    const L = MD.LAYER;
    shadow(c, p.x, p.y + 2, 40, 0.25);
    let cum = 0;
    c.save(); c.translate(p.x, p.y); c.scale(1, p.squash || 1);
    for (const l of p.layers) {
      const d = L[l.key]; if (!d) continue;
      if (d.band) {
        c.fillStyle = d.band; c.fillRect(-d.w / 2 + 6, -cum - 4, d.w - 12, 4);
      } else {
        spr(c, l.key, 0, -cum, d.w);
      }
      cum += d.dy;
    }
    c.restore();
  }

  /* ---------- 店员 ---------- */
  function drawWorker(c, E) {
    const w = E.worker, S = MD.WS, im = IMG._worker; if (!im) return;
    const t = w.phase;
    const bob = w.moving ? Math.abs(Math.sin(t * 6)) * 4 : Math.sin(t * 2) * 1.2;
    const lift = w.held ? 8 : 0; // 拿东西时整个人抬起 8px
    const sad = w.sadT / 2000;
    shadow(c, w.x, w.y, 30 * S + 6, 0.28);

    // 身体
    c.save();
    c.translate(w.x, w.y - bob - lift);
    c.scale(w.face === -1 ? -S : S, S);
    if (w.moving) c.rotate(Math.sin(t * 6) * 0.04);
    c.translate(0, sad * 5);
    if (sad > 0) c.rotate(sad * 0.08 * w.face);
    c.drawImage(im, -im.width / 2, -im.height);
    drawFace(c, w, sad, t);
    c.restore();
  }
  /* 在原图脸部上盖表情：高兴=不处理；伤心=皱眉+泪滴+下弯嘴 */
  function drawFace(c, w, sad, t) {
    if (sad <= 0.01) return;
    const hw = 77; // 图中脸的水平中心
    c.save(); c.globalAlpha = Math.min(1, sad * 1.2);
    c.translate(-77, -200);          // 回到图左上角坐标系
    // 盖掉原来的笑嘴
    c.fillStyle = '#fbe3b0'; c.fillRect(104 - 24, 99, 48, 18);
    c.strokeStyle = '#6d3322'; c.lineWidth = 2.6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(68, 114); c.quadraticCurveTo(92, 102, 116, 114); c.stroke();   // 下弯嘴，弧度更大
    // 眉毛：八字眉（更夸张）
    c.strokeStyle = '#3a1f10'; c.lineWidth = 3.4;
    c.beginPath(); c.moveTo(58, 78); c.lineTo(82, 67); c.stroke();
    c.beginPath(); c.moveTo(140, 78); c.lineTo(116, 67); c.stroke();
    // 眼泪（两滴，不同节奏）
    const drip = (t * 44) % 26;
    c.fillStyle = '#5dbaed';
    c.beginPath(); c.ellipse(72, 98 + drip * 0.7, 3.2, 4.8, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(128, 98 + ((drip + 10) % 26) * 0.7, 3.2, 4.8, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  /* ---------- 头顶气泡 ---------- */
  function bubble(c, E) {
    const w = E.worker, b = w.bubble; if (!b) return;
    const H = 200 * MD.WS;
    const x = w.x + 62, y = w.y - H - 18 - Math.sin(w.phase * 3) * 2;
    c.save();
    c.fillStyle = '#fff6df'; c.strokeStyle = '#c9702b'; c.lineWidth = 3;
    c.beginPath(); c.roundRect(x - 36, y - 36, 72, 66, 14); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(x - 24, y + 28); c.lineTo(x - 36, y + 46); c.lineTo(x - 8, y + 29); c.closePath();
    c.fillStyle = '#fff6df'; c.fill(); c.stroke(); c.fillRect(x - 25, y + 26, 16, 4);
    spr(c, b.sprite, x, y + 24, 46);
    if (b.cross) {
      c.strokeStyle = '#d6221a'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - 24, y - 24); c.lineTo(x + 24, y + 22); c.moveTo(x + 24, y - 24); c.lineTo(x - 24, y + 22); c.stroke();
    }
    c.restore();
  }

  /* ---------- 出餐台标签 / 步骤字幕 ---------- */
  function caption(c, E) {
    const o = E.cur; if (!o || !o.step) return;
    const s = o.step; c.save();
    c.font = 'bold 22px "Microsoft YaHei", sans-serif'; c.textAlign = 'center';
    const w = c.measureText(s).width + 36;
    c.fillStyle = 'rgba(40,20,10,0.72)'; c.beginPath(); c.roundRect(446 - w / 2, 990, w, 38, 19); c.fill();
    c.fillStyle = '#ffe08a'; c.fillText(s, 446, 1016); c.restore();
  }

  MD.render = function (c, E) {
    c.clearRect(0, 0, MD.W, MD.H);
    if (IMG._bg) c.drawImage(IMG._bg, 0, 0);
    // 以 y 排序：道具、店员
    const items = E.props.filter((p) => !p.held).map((p) => ({ y: p.y, f: () => drawProp(c, p) }));
    items.push({ y: E.worker.y, f: () => drawWorker(c, E) });
    items.sort((a, b) => a.y - b.y);
    items.forEach((i) => i.f());
    // 手里拿着的东西盖在手上
    E.props.filter((p) => p.held).forEach((p) => drawProp(c, p));
    E.fxs.forEach((f) => f.fn(c));
    for (const q of E.parts) {
      c.globalAlpha = Math.max(0, Math.min(1, q.life / (q.max * 0.6)));
      c.fillStyle = q.color; c.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size);
    }
    c.globalAlpha = 1;
    bubble(c, E);
    caption(c, E);
  };
})(typeof window !== 'undefined' ? window : globalThis);
