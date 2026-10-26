/* 汉堡小游戏 · 玩法核心：状态机、双手动作编排、叠汉堡、撤销、出餐。 */
(function () {
  const FP = window.FP;
  const LAY = window.FP_LAYOUT;
  const E = {
    lin: (t) => t,
    io: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t,
    back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  };
  FP.EASE = E;
  const sfx = (n, o) => { try { FP.sfx && FP.sfx.play(n, o); } catch (e) { /* 静音也不报错 */ } };
  FP.sfxPlay = sfx;

  /* 每种配料从后厨哪里取：站台对应的取料点（场景坐标，带一点随机以便区分同类） */
  const ST = {
    bun:   [[150, 690], [108, 742], [232, 758]],
    veg:   [[95, 470], [250, 486], [500, 486], [660, 486], [300, 452]],
    cheese:[[455, 505], [530, 505]],
    grill: [[620, 222], [700, 210], [790, 214], [870, 210]],
    fry:   [[1080, 212], [1180, 198]],
    sauce: [[1288, 430], [1392, 452]],
    spice: [[1150, 636], [1232, 660]],
  };
  const HASH = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973; return h; };
  FP.stationOf = function (id) {
    const it = FP.ING[id];
    if (it.cat === 'bun') return 'bun';
    if (it.cat === 'sauce') return 'sauce';
    if (it.cat === 'spice') return 'spice';
    if (it.cat === 'veg') return 'veg';
    if (it.cat === 'egg') return 'cheese';
    if (it.tags.includes('chicken') && !it.tags.includes('grilled')) return 'fry';
    return 'grill';
  };
  FP.stationPoint = (id) => { const a = ST[FP.stationOf(id)]; return a[HASH(id) % a.length]; };

  const R_REST = [1072, 606];      // 右手待命时捏合点的位置

  function restL() { return FP.handAnchor('L', FP.restPose('L'), 'touch'); }
  FP.restL = restL;

  class Game {
    constructor(opt) {
      opt = opt || {};
      this.on = opt.on || function () {};
      this.mode = 'free';
      this.recipe = null;
      this.items = [];          // {id, offY, a, squash, sauce}
      this.queue = [];
      this.busy = false;
      this.tweens = [];
      this.parts = [];
      this.t = 0;
      this.served = null;
      this.hold = null;         // {id, kind, rot, a} 右手举着的东西
      this.hands = {
        L: { pose: FP.restPose('L'), press: 0 },
        R: { pose: FP.poseFromAnchor('R', R_REST.slice(), 0), rot: 0 },
      };
      this.stackPos = LAY.board.stackBase.slice();
      this.shake = 0;
    }

    /* ---------- 生命周期 ---------- */
    start(o) {
      o = o || {};
      this.mode = o.mode || 'free';
      this.recipe = o.recipe || null;
      this.items = []; this.queue = []; this.tweens = []; this.parts = [];
      this.served = null; this.busy = false; this.hold = null;
      this.hands.R.rot = 0;
      this.emit('change');
    }
    emit(kind, data) { this.on(kind, data, this); }
    ids() { return this.items.map((x) => x.id); }
    top() { return this.items.length ? this.items[this.items.length - 1].id : null; }
    /* 界面判断进度时用它：已放好的 + 正在手上飞的 + 排队的 */
    plan() {
      return this.ids().concat(this.busy && this.busy !== 'serve' ? [this.busy] : [], this.queue);
    }
    layers() {
      const L = FP.layersOf(this.items, this.stackPos[0], this.stackPos[1]);
      // 层数多的时候整体稍微下压，避免高汉堡顶到画面顶部
      const drop = Math.min(46, this.items.length * 4);
      for (const l of L) {
        l.yBottom += drop; l.surface += drop;
        if (l.seam !== undefined) l.seam += drop;
      }
      L.drop = drop;
      return L;
    }

    /* ---------- 补间 ---------- */
    tween(ms, fn, ease) {
      return new Promise((res) => {
        this.tweens.push({ ms: Math.max(1, ms), el: 0, fn, ease: ease || E.lin, res });
      });
    }
    wait(ms) { return this.tween(ms, null); }
    update(dt) {
      this.t += dt;
      // 只处理本帧开始时就已经存在的补间：补间完成时回调里新建的补间留到下一帧，
      // 否则这一帧循环里新 push 的补间会被误判成“本帧结算”的旧补间。
      const batch = this.tweens;
      this.tweens = [];
      const still = [];
      for (const tw of batch) {
        tw.el += dt;
        const p = Math.min(1, tw.el / tw.ms);
        if (tw.fn) tw.fn(tw.ease(p), p);
        if (p >= 1) tw.res(); else still.push(tw);
      }
      this.tweens = still.concat(this.tweens);
      for (const it of this.items) {
        if (it.offY) it.offY *= Math.max(0, 1 - dt / 110);
        if (it.a < 1) it.a = Math.min(1, it.a + dt / 140);
        if (it.squash && it.squash !== 1) it.squash += (1 - it.squash) * Math.min(1, dt / 70);
      }
      for (const q of this.parts) {
        q.life -= dt; q.x += q.vx * dt / 1000; q.y += q.vy * dt / 1000; q.vy += (q.g || 900) * dt / 1000;
      }
      this.parts = this.parts.filter((q) => q.life > 0);
      this.shake = Math.max(0, this.shake - dt / 240);
      if (!this.busy && this.queue.length) this._run(this.queue.shift());
      else if (!this.busy) this._idle(dt);
    }

    /* ---------- 待机：双手轻轻浮动 ---------- */
    _idle(dt) {
      const bob = Math.sin(this.t / 680) * 3.2;
      const r = this.hands.R, l = this.hands.L;
      const wantR = FP.poseFromAnchor('R', [R_REST[0], R_REST[1] + bob], r.rot, 'pinch');
      const lr = restL();
      const wantL = FP.poseFromAnchor('L', [lr[0], lr[1] + bob * 0.6], l.pose.rot, 'touch');
      const k = Math.min(1, dt / 300);
      for (let i = 0; i < 2; i++) {
        r.pose.wrist[i] += (wantR.wrist[i] - r.pose.wrist[i]) * k;
        l.pose.wrist[i] += (wantL.wrist[i] - l.pose.wrist[i]) * k;
      }
      l.press = Math.max(0, l.press - dt / 220);
    }

    /* ---------- 加一层 ---------- */
    add(id) {
      if (this.served) return false;
      // 规则按「已放好的 + 正在手上飞的 + 排队中的」整体判断，否则上一层还在飞时会被误判成空砧板
      const flying = this.busy && this.busy !== 'serve' ? [this.busy] : [];
      const virtual = this.ids().concat(flying, this.queue);
      const chk = FP.canPlace(virtual, id);
      if (!chk.ok) { this.emit('toast', chk.why); sfx('bad'); return false; }
      this.queue.push(id);
      if (!this.busy) this._run(this.queue.shift());
      this.emit('change');
      return true;
    }
    undo() {
      if (this.served) return;
      if (this.busy) {
        if (this.queue.length) { this.queue = []; this.emit('toast', '已取消排队中的料'); }
        else this.emit('toast', '等这一层放稳');
        return;
      }
      if (!this.items.length) { this.emit('toast', '还没有东西可以撤销'); return; }
      const it = this.items[this.items.length - 1];
      sfx('undo');
      this.hands.L.press = 1;
      this.tween(240, (k) => { it.offY = -80 * k; it.a = 1 - k * 0.85; }).then(() => {
        this.items = this.items.filter((x) => x !== it);
        this.emit('change');
      });
    }
    clear() {
      if (this.served || this.busy) { if (this.busy) this.emit('toast', '等这一层放稳'); return; }
      if (!this.items.length) return;
      sfx('clear');
      const list = this.items.slice();
      this.tween(420, (k) => {
        list.forEach((it, i) => { it.offY = -240 * k - i * 8 * k; it.a = 1 - k; });
      }).then(() => { this.items = []; this.emit('change'); });
      this.emit('change');
    }

    /* ---------- 出餐 ---------- */
    serve() {
      if (this.served || this.busy) { if (this.busy) this.emit('toast', '别急，正在做'); return; }
      const ids = this.ids();
      let res;
      if (this.recipe) {
        res = Object.assign({ kind: 'recipe', name: this.recipe.name, blurb: this.recipe.blurb,
          burger: this.recipe.id }, FP.score(this.recipe, ids));
        res.price = FP.price(ids);
        res.kcal = FP.kcal(ids);
      } else {
        res = Object.assign({ kind: 'free' }, FP.freeScore(ids));
        res.burger = (FP.matchRecipe(ids) || {}).id || null;
        res.blurb = res.valid ? '主厨特制，菜单上没有' : '这份还不能出餐';
      }
      if (!ids.length) { this.emit('toast', '先做一个汉堡吧'); sfx('bad'); return; }
      if (!this.recipe && !res.valid) { this.emit('toast', res.notes[0] || '还不能出餐'); sfx('bad'); return; }
      res.stackPreview = ids.slice();
      this.busy = 'serve';
      sfx('ding');
      const list = this.items.slice();
      this.tween(700, (k) => {
        this.hands.L.press = Math.sin(k * Math.PI);
        list.forEach((it) => { it.offY = -26 * k; it.a = k < 0.72 ? 1 : 1 - (k - 0.72) / 0.28; });
      }, E.io).then(() => {
        this.served = res;
        this.busy = false;
        this.items = [];
        this.emit('served', res);
        this.emit('change');
      });
    }
  }

  FP.Game = Game;
  FP.R_REST = R_REST;
})();
