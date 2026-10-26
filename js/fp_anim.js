/* 汉堡小游戏 · 动作编排：右手从后厨取料并放到砧板上，左手在旁扶一把。
 * 所有动作都通过补间完成，叠放中的状态变化交给 Game.update 处理。 */
(function () {
  const FP = window.FP;
  const G = FP.Game.prototype;
  const E = FP.EASE;
  const R_REST = FP.R_REST;
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerp2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];

  /* 右手的捏合点移到 p，同时旋转到手势 rot（rot 是相对手腕轴心的角度） */
  function moveR(g, p, rot, ms, ease, arc) {
    const s = FP.handAnchor('R', g.hands.R.pose, 'pinch');
    const sRot = g.hands.R.rot;
    return g.tween(ms, (k) => {
      const q = lerp2(s, p, k);
      if (arc) q[1] -= Math.sin(k * Math.PI) * arc;
      g.hands.R.rot = lerp(sRot, rot, k);
      g.hands.R.pose = FP.poseFromAnchor('R', q, g.hands.R.rot, 'pinch');
    }, ease || E.io);
  }
  FP.moveR = moveR;

  /* 左手扶一下汉堡左边，再松开回位 */
  function assist(g, ms) {
    const base = FP.restL();
    const top = g.layers();
    const target = [g.stackPos[0] - 172, g.stackPos[1] - Math.min(190, top.total * 0.72) - 26];
    const s = FP.handAnchor('L', g.hands.L.pose, 'touch');
    const sRot = g.hands.L.pose.rot || 0;
    return g.tween(ms, (k) => {
      g.hands.L.press = Math.sin(Math.min(1, k * 1.1) * Math.PI);
      const q = lerp2(s, target, Math.min(1, k * 1.7));
      g.hands.L.pose = FP.poseFromAnchor('L', q, sRot, 'touch');
    }, E.io).then(() => g.tween(ms * 0.9, (k) => {
      g.hands.L.press = 1 - k;
      const q = lerp2(target, base, k);
      g.hands.L.pose = FP.poseFromAnchor('L', q, sRot, 'touch');
    }, E.io));
  }
  FP.assist = assist;

  function puff(g, x, y, n) {
    for (let i = 0; i < n; i++) {
      g.parts.push({
        x: x + (Math.random() - 0.5) * 120, y: y - Math.random() * 8,
        vx: (Math.random() - 0.5) * 150, vy: -30 - Math.random() * 60, g: 240,
        life: 260 + Math.random() * 220, max: 480, color: '#fff6e0', size: 3 + Math.random() * 3,
      });
    }
  }
  FP.puff = puff;

  /* ---------- 主流程 ---------- */
  G._run = async function (id) {
    this.busy = id;
    const it = FP.ING[id];
    try {
      if (it.role === 'sauce') await this._sauce(id, it);
      else if (it.role === 'sprinkle') await this._sprinkle(id, it);
      else await this._layer(id, it);
    } catch (err) { console.error('[fp]', err); }
    this.busy = false;
    this.queueStep = 0;
    this.emit('change');
  };

  /* 实心层：面包 / 肉饼 / 蔬菜 / 芝士 / 蛋 */
  G._layer = async function (id, it) {
    const from = FP.stationPoint(id);
    FP.sfxPlay('pick');
    // 1. 伸手到料台
    await moveR(this, [from[0] + 20, from[1] - 46], -0.34, 300, E.out);
    this.hold = { id, kind: 'spr', rot: 0.08, scale: 0.5 };
    this.emit('change');
    await this.wait(60);
    // 2. 举着料飞回砧板上方
    const lv = this.layers();
    const dropY = lv.surface;
    await moveR(this, [this.stackPos[0] + 56, dropY - 44], -0.10, 400, E.io, 54);
    // 3. 松手：料落下、压一下
    this.hold = null;
    const item = { id, offY: -130, a: 0.7, squash: 1 };
    this.items.push(item);
    FP.sfxPlay('drop', { i: this.items.length - 1 });
    this.emit('change');
    await this.tween(210, (k) => { item.offY = -130 * (1 - k); item.a = 0.7 + 0.3 * k; }, E.out);
    item.offY = 0; item.squash = 0.86;
    puff(this, this.stackPos[0], dropY - 10, 4);
    // 4. 左手扶一下，右手归位
    const a = assist(this, 150);
    await moveR(this, R_REST.slice(), 0, 260, E.io);
    await a;
  };

  /* 酱料：举着酱瓶对着汉堡挤一圈 */
  G._sauce = async function (id, it) {
    const lv = this.layers();
    const y = lv.surface;
    FP.sfxPlay('pick');
    await moveR(this, [this.stackPos[0] + 118, y - 150], -0.62, 320, E.out);
    this.hold = { id, kind: 'bottle', rot: 0, a: 1 };
    this.emit('change');
    FP.sfxPlay('squish');
    const item = { id, offY: 0, a: 1, squash: 1, sauce: [] };
    this.items.push(item);
    item.onTop = lv.surface;
    await this.tween(560, (k) => {
      this.hands.R.rot = -0.55 - Math.sin(k * Math.PI) * 0.5;
      const q = [this.stackPos[0] + 118 - Math.sin(k * 10) * 32, y - 150 + k * 44];
      this.hands.R.pose = FP.poseFromAnchor('R', q, this.hands.R.rot, 'pinch');
      if (k > 0.15 && k < 0.96) {
        item.sauce.push({ x: this.stackPos[0] - 62 + k * 118 + Math.sin(k * 17) * 7, y: y - 8 + Math.cos(k * 13) * 4, y0: y, r: 7 + Math.random() * 4 });
      }
    }, E.io);
    this.hold = null;
    this.emit('change');
    const a = assist(this, 140);
    await moveR(this, R_REST.slice(), 0, 260, E.io);
    await a;
  };

  /* 调味：捏一撮撒下去 */
  G._sprinkle = async function (id, it) {
    const lv = this.layers();
    const y = lv.surface;
    FP.sfxPlay('pick');
    await moveR(this, [this.stackPos[0] + 46, y - 160], -0.18, 300, E.out);
    this.hold = { id, kind: 'spr', rot: 0, scale: 0.26 };
    FP.sfxPlay('sprinkle');
    const color = id === 'I51' ? '#ffffff' : id === 'I52' ? '#3a2a22' : '#efd9a8';
    for (let i = 0; i < 18; i++) {
      this.parts.push({
        x: this.stackPos[0] + 46 + (Math.random() - 0.5) * 70, y: y - 160,
        vx: (Math.random() - 0.5) * 110, vy: 40 + Math.random() * 90, g: 620,
        life: 480 + Math.random() * 260, max: 740, color, size: 3 + Math.random() * 2,
      });
    }
    this.items.push({ id, offY: 0, a: 1, squash: 1 });
    await this.wait(300);
    this.hold = null;
    this.emit('change');
    await moveR(this, R_REST.slice(), 0, 250, E.io);
  };
})();
