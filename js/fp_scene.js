/* 汉堡小游戏 · 场景层：加载图片、画后厨、砧板上的汉堡堆、白手套双手（含程序绘制的红袖子）。
 * 所有坐标在 1536x1024 的「场景像素」里，最后整体缩放；像素图一律 nearest 采样。 */
(function () {
  const FP = (window.FP = window.FP || {});
  const LAY = window.FP_LAYOUT;
  const IMG = {};
  FP.IMG = IMG;

  const load = (key, src) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { IMG[key] = im; res(); };
    im.onerror = () => { console.warn('[fp] missing image', src); res(); };
    im.src = src;
  });

  FP.loadImages = function () {
    const jobs = [load('kitchen', 'assets/fp/kitchen_bg.png')];
    jobs.push(load('hand_L', 'assets/fp/' + LAY.hands.L.file));
    jobs.push(load('hand_R', 'assets/fp/' + LAY.hands.R.file));
    Object.keys(window.FP_SPR || {}).forEach((k) => {
      jobs.push(load(k, 'assets/fp/' + (k[0] === 'B' ? 'burger/' : 'ing/') + k + '.png'));
    });
    return Promise.all(jobs);
  };

  /* ---------- 基础工具 ---------- */
  // 以 (x, y) 为底部中心画图（和参考图里食材的摆法一致）
  function spr(c, key, x, y, w, o) {
    const im = IMG[key];
    if (!im) return;
    o = o || {};
    const sc = o.scale === undefined ? 1 : o.scale;
    const ww = w * sc, hh = ww * im.height / im.width;
    c.save();
    c.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * c.globalAlpha;
    c.translate(x, y);
    if (o.rot) c.rotate(o.rot);
    if (o.flip) c.scale(-1, 1);
    c.drawImage(im, -ww / 2, o.center ? -hh / 2 : -hh, ww, hh);
    c.restore();
  }
  FP.spr = spr;

  function shadow(c, x, y, rx, ry, a) {
    c.save();
    c.globalAlpha = a === undefined ? 0.26 : a;
    c.fillStyle = '#2a170c';
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  FP.shadow = shadow;

  /* ---------- 手套姿态：统一以腕口为旋转轴 ---------- */
  /* 轴心 = 袖口段中心。位置由布局里的 wrist（场景坐标）给出，所以各个手套的自有像素不再参与计算。 */
  function pivotWorld(side, pose) {
    const st = LAY.sleeve[side];
    return pose.wrist || st.wrist;
  }
  /* 手套上某个锚点（pinch/touch/wrist）在世界里的坐标 */
  FP.handAnchor = function (side, pose, which) {
    const H = LAY.hands[side], sc = pose.scale === undefined ? 1 : pose.scale;
    const rot = pose.rot || 0;
    const wv = pivotWorld(side, pose);
    const ox = (H[which || 'pinch'][0] - H.wrist[0]) * sc;
    const oy = (H[which || 'pinch'][1] - H.wrist[1]) * sc;
    return [
      wv[0] + ox * Math.cos(rot) - oy * Math.sin(rot),
      wv[1] + ox * Math.sin(rot) + oy * Math.cos(rot),
    ];
  };
  /* 已知锚点的世界坐标 -> 手套姿态（含腕口世界坐标） */
  FP.poseFromAnchor = function (side, p, rot, which, scale) {
    const H = LAY.hands[side], sc = scale === undefined ? 1 : scale;
    const ox = (H[which || 'pinch'][0] - H.wrist[0]) * sc;
    const oy = (H[which || 'pinch'][1] - H.wrist[1]) * sc;
    const rx = ox * Math.cos(rot) - oy * Math.sin(rot);
    const ry = ox * Math.sin(rot) + oy * Math.cos(rot);
    return { wrist: [p[0] - rx, p[1] - ry], rot, scale: sc };
  };
  FP.restPose = (side) => ({ wrist: LAY.sleeve[side].wrist.slice(), rot: 0, scale: 1 });

  /* ---------- 红袖子 ----------
   * 第一人称：手臂永远从画面下沿伸进来。所以袖子的起点取「腕口沿固定角度往下画到画面外」，
   * 而不是画面角落的固定点——这样手抬到料台时，袖子只是跟着抬起来的一段前臂，
   * 不会变成一条横穿砧板的大红斜块。 */
  // 袖子走向沿用参考图里两条手臂的角度（L 137.5°、R 55°），手抬起时袖子跟着收细，不会横穿画面
  function sleeveOrigin(side, wrist) {
    const ang = (LAY.sleeve[side].angle * Math.PI) / 180;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const t = (LAY.H + 90 - wrist[1]) / uy;        // 走到画面下沿之外的所需长度
    return { from: [wrist[0] + ux * t, wrist[1] + uy * t], len: t };
  }
  function drawSleeve(c, side, wrist, ang, sc) {
    const S = LAY.sleeve, st = S[side], col = S.colors;
    const o = sleeveOrigin(side, wrist);
    const sh = o.from, len = o.len;
    const a = Math.atan2(wrist[1] - sh[1], wrist[0] - sh[0]);
    const w0 = st.halfWidthAtWrist * (sc || 1) * 0.52, w1 = w0 * 1.34;
    c.save();
    c.translate(sh[0], sh[1]);
    c.rotate(a);
    const g = c.createLinearGradient(0, -w1, 0, w1);
    g.addColorStop(0, col.red);
    g.addColorStop(0.55, col.red);
    g.addColorStop(1, col.redDark);
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, -w1);
    c.quadraticCurveTo(len * 0.55, -w1 * 0.95, len, -w0);
    c.lineTo(len, w0);
    c.quadraticCurveTo(len * 0.55, w1 * 0.95, 0, w1);
    c.closePath();
    c.fill();
    c.save();
    c.clip();
    // 金色条纹：靠近腕口的那一圈
    c.fillStyle = col.stripe;
    const t = Math.max(0.1, 1 - 120 / len);
    const x = len * t, hw = w1 + (w0 - w1) * t;
    c.fillRect(x, -hw - 3, 13, hw * 2 + 6);
    c.fillRect(x - 30, -hw - 7, 6, hw * 2 + 14);
    c.fillStyle = 'rgba(110,10,8,0.22)';
    c.fillRect(0, hw * 0.5, len, hw);
    c.restore();
    c.strokeStyle = col.outline;
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(0, -w1);
    c.quadraticCurveTo(len * 0.55, -w1 * 0.95, len, -w0);
    c.moveTo(0, w1);
    c.quadraticCurveTo(len * 0.55, w1 * 0.95, len, w0);
    c.stroke();
    c.restore();
    void ang;
  }

  /* ---------- 画一只手 ---------- */
  function drawHand(c, side, pose) {
    const im = IMG['hand_' + side];
    if (!im) return;
    const H = LAY.hands[side];
    const sc = pose.scale === undefined ? 1 : pose.scale;
    const w = im.width * sc, h = im.height * sc;
    const press = pose.press || 0;
    const wv = pivotWorld(side, pose);
    drawSleeve(c, side, wv, 0, sc);
    // 整图左上角 = 腕口世界坐标 - 腕口在整图里的像素偏移（再考虑旋转）
    const ox = -H.wrist[0] * sc, oy = -H.wrist[1] * sc;
    const rot = pose.rot || 0;
    c.save();
    c.translate(wv[0] + ox * Math.cos(rot) - oy * Math.sin(rot) + (side === 'L' ? 8 : -8) * press,
      wv[1] + ox * Math.sin(rot) + oy * Math.cos(rot) + press * 5);
    c.rotate(rot);
    c.drawImage(im, 0, 0, w, h);
    c.restore();
  }
  FP.drawHand = drawHand;

  /* ---------- 汉堡堆的几何 ---------- */
  /* items: [{id, offY, a, squash, sauce:[{x,y,r}]}]，从下往上。
   * 每层图片都按「底边落在当前累计高度」放置；同时算出这一层图片的可见顶面，
   * 酱料/调味要落在上一层的顶面上，而不是几何高度上。 */
  const MIN_SY = { bunBottom: 0.55, bunTop: 0.46, bunMid: 0.5, layer: 0.34, sauce: 0.25, sprinkle: 0.25 };
  FP.layersOf = function (items, baseX, baseY, grow) {
    const out = [];
    let y = baseY, prevSurface = baseY;
    items.forEach((item, i) => {
      const it = FP.ING[item.id];
      const w = it.w * (grow === false ? 1 : 1 - Math.min(0.18, i * 0.014));
      const ratio = window.FP_SPR[item.id] ? window.FP_SPR[item.id].h / window.FP_SPR[item.id].w : 0.4;
      const imgH = w * ratio;
      // 纵压系数：俯视下每层只露一条厚边（和绘制用同一套算法）
      const sy = Math.max(MIN_SY[it.role] || 0.3, Math.min(1, (it.rise * 2.9) / imgH));
      const visH = imgH * sy;
      const surfY = (it.role === 'sauce' || it.role === 'sprinkle')
        ? prevSurface
        : y - visH * (it.role === 'bunTop' ? 0.16 : 0.55);   // 面包顶是“盖子”，顶面在图中偏上一点
      out.push({ id: item.id, it, i, x: baseX, yBottom: y, w, imgH, visH, sy, rise: it.rise,
        surface: surfY, offY: item.offY || 0, a: item.a === undefined ? 1 : item.a,
        squash: item.squash || 1, sauce: item.sauce });
      if (it.role !== 'sauce' && it.role !== 'sprinkle') prevSurface = surfY;
      y -= it.rise;
    });
    // 第二遍：酱料/调味贴着上一层（面包/肉饼）的下沿，挤出来才看得见
    out.forEach((L, i) => {
      if (L.it.role !== 'sauce' && L.it.role !== 'sprinkle') return;
      let j = i + 1;
      // 越过连续的酱料层，找到上面的实体层
      while (out[j] && (out[j].it.role === 'sauce' || out[j].it.role === 'sprinkle')) j++;
      // 酱料贴在上面那层可见下沿稍下的位置：挤出来才看得见
      L.seam = j < out.length ? Math.max(L.surface, out[j].yBottom + 12) : L.surface;
    });
    out.total = baseY - y;
    out.topY = y;
    out.surface = prevSurface;
    return out;
  };

  FP.sauceColor = (id) => ({
    I40: '#cf1f11', I41: '#efb60c', I42: '#fff4d6', I43: '#ef8a1d', I44: '#f5c69c',
    I45: '#f6efd2', I46: '#4d1f0d', I47: '#e8541b', I48: '#efc23a', I49: '#f0a01b',
  }[id] || '#e0a050');

  /* ---------- 整帧 ---------- */
  /* 每一层的投影：预先给每张配料图做一份「深色剪影」（只做一次，缓存在 SIL 里），
   * 渲染时把它偏移几个像素垫在本层下面。这样两层之间有一条暗缝，不会糊在一起。 */
  const SIL = {};
  function silhouette(key) {
    if (SIL[key]) return SIL[key];
    const im = IMG[key];
    if (!im || !im.width) return null;
    const cv = document.createElement('canvas');
    cv.width = im.width; cv.height = im.height;
    const x = cv.getContext('2d');
    x.drawImage(im, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#3a1808';
    x.fillRect(0, 0, cv.width, cv.height);
    SIL[key] = cv;
    return cv;
  }
  function drawLayerShadow(c, key, w, dy) {
    const sil = silhouette(key);
    if (!sil) return;
    const ww = w, hh = ww * sil.height / sil.width;
    c.save();
    c.globalAlpha *= 0.42;
    c.translate(0, dy);
    c.drawImage(sil, -ww / 2, -hh, ww, hh);
    c.restore();
  }

  /* v.layers 是整叠已落稳的层；v.flying 是正在下落的那一层（单独画，带自己的 offY） */
  FP.drawScene = function (c, v) {
    c.clearRect(0, 0, LAY.W, LAY.H);
    if (IMG.kitchen) c.drawImage(IMG.kitchen, 0, 0, LAY.W, LAY.H);
    const layers = v.layers || [];
    const flying = v.flying || null;
    if (layers.length || flying) shadow(c, v.stackPos[0] + 6, v.stackPos[1] + 4, 186, 32, 0.15);
    if (v.under) v.under(c, layers);

    const drawOne = (L) => {
      const it = L.it;
      c.save();
      c.globalAlpha = L.a;
      const y = L.yBottom + (L.offY || 0) + (it.role === 'bunTop' ? 4 : -1);
      if (it.role === 'sauce') {
        c.fillStyle = FP.sauceColor(L.id);
        // 酱料抹在下面那层的顶面上（L.surface 已按纵压后的可见高度算过）
        const sy2 = (L.seam === undefined ? L.surface : L.seam) + (L.offY || 0);
        if (L.sauce && L.sauce.length) {
          for (const s of L.sauce) {
            c.beginPath(); c.ellipse(s.x, sy2, s.r * 1.9, s.r * 0.5, 0, 0, Math.PI * 2); c.fill();
          }
        } else {
          c.beginPath(); c.ellipse(L.x, sy2, L.w * 0.6, L.rise * 0.62, 0, 0, Math.PI * 2); c.fill();
        }
        c.globalAlpha = L.a * 0.45; c.fillStyle = '#ffffff';
        c.beginPath(); c.ellipse(L.x - L.w * 0.1, sy2 - 2, L.w * 0.16, 3, 0, 0, Math.PI * 2); c.fill();
      } else if (it.role === 'sprinkle') {
        c.fillStyle = L.id === 'I51' ? '#ffffff' : L.id === 'I52' ? '#3a2a22' : '#efd9a8';
        const seed = (L.i + 1) * 37;
        for (let k = 0; k < 30; k++) {
          const a = (seed + k * 2.399) % 6.283, rr = 0.25 + ((seed + k * 13) % 100) / 140;
          const px = L.x + Math.cos(a) * L.w * 0.5 * rr;
          const py = L.surface + 3 + Math.sin(a) * 9 * rr;
          c.fillRect(px, py, 3, 3);
        }
      } else {
        // 按 rise 把图片纵向压缩：俯视角度下每一层只露一条厚边，像真的叠起来
        c.translate(L.x, y);
        c.scale(1 + (1 - (L.squash || 1)) * 0.35, L.sy * (L.squash || 1));
        // 先给这一层垫一道投影：和下一层之间分出暗缝
        drawLayerShadow(c, L.id, L.w, 26);
        spr(c, L.id, 0, 0, L.w);
      }
      c.restore();
    };

    for (const L of layers) drawOne(L);
    if (flying) drawOne(flying);

    if (v.over) v.over(c, layers);

    for (const q of v.parts || []) {
      c.globalAlpha = Math.max(0, Math.min(1, q.life / (q.max * 0.6)));
      c.fillStyle = q.color;
      c.fillRect(Math.round(q.x), Math.round(q.y), Math.ceil(q.size), Math.ceil(q.size));
    }
    c.globalAlpha = 1;

    // 手里举着的料：先画手，再画料，看起来像被捏住
    if (v.hands) {
      drawHand(c, 'L', v.hands.L.pose);
      drawHand(c, 'R', v.hands.R.pose);
    }
    const hold = v.hold;
    if (hold && v.hands) {
      const p = FP.handAnchor('R', v.hands.R.pose, 'pinch', 1.0);
      c.save();
      c.translate(p[0] - 14, p[1] + 10);
      c.rotate((v.hands.R.rot || 0) * 0.5 + (hold.rot || 0));
      c.globalAlpha = hold.a === undefined ? 1 : hold.a;
      if (hold.kind === 'bottle') {
        // 酱料瓶：一段带瓶口的软管，倾斜着往下挤
        c.fillStyle = FP.sauceColor(hold.id);
        c.beginPath(); c.roundRect(-17, -74, 34, 80, 11); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.30)'; c.fillRect(-11, -66, 6, 58);
        c.strokeStyle = 'rgba(60,25,10,.45)'; c.lineWidth = 2.5;
        c.beginPath(); c.roundRect(-17, -74, 34, 80, 11); c.stroke();
        c.fillStyle = '#2d1a10'; c.fillRect(-7, 6, 14, 9);
      } else if (IMG[hold.id]) {
        const it = FP.ING[hold.id];
        spr(c, hold.id, 0, 0, it.w * (hold.scale || 0.34));
      }
      c.restore();
    }
  };
})();
