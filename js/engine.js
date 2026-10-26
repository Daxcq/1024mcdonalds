/* 引擎：订单队列 + 店员状态机 + 可中断动画计时器。
 * 规则：
 *  - 严格 FIFO，一次只做一份，做完才做下一份。
 *  - 取消“排队中”的：直接移除。
 *  - 取消“制作中”的：立即中断，店员伤心地把手上/台上的半成品丢进垃圾桶，再继续下一份。
 *  - 取消“已完成”的：排到当前这份做完之后，伤心地去出餐台把它丢掉（丢弃任务优先于新订单）。
 */
(function (g) {
  const MD = g.MD;
  class Abort extends Error {}
  MD.Abort = Abort;

  const EASE = {
    lin: (t) => t,
    io: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t,
    back: (t) => { const c = 2.70158; return 1 + c * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); },
  };
  MD.EASE = EASE;

  /* 手的位置：从肩膀伸向目标，最长 64px（够不着的东西靠“飞”过来） */
  MD.shoulder = (w) => [w.x + w.face * 14 * MD.WS, w.y - 64 * MD.WS];
  MD.handPos = (w, t, k) => {
    const s = MD.shoulder(w), dx = t[0] - s[0], dy = t[1] - s[1], d = Math.hypot(dx, dy) || 1;
    const L = Math.min(d, 64) * k;
    return [s[0] + dx / d * L, s[1] + dy / d * L];
  };

  class Engine {
    constructor() {
      this.t = 0; this.speed = 1;
      this.timers = []; this.props = []; this.fxs = []; this.parts = [];
      this.orders = []; this.jobs = []; this.seq = 0; this.cur = null;
      this.listeners = [];
      const h = MD.ST.home.stand;
      this.worker = {
        x: h[0], y: h[1], moving: false, phase: 0, face: 1, held: null, reach: null,
        mood: 'happy', sadT: 0, bubble: null, workBob: 0,
      };
      this.slots = new Array(MD.PASS.cols * MD.PASS.rows * 2).fill(null);
      this.idleFor = 0;
      this._loop();
    }

    /* ---------- 事件 ---------- */
    on(fn) { this.listeners.push(fn); }
    emit() { for (const f of this.listeners) f(this); }

    /* ---------- 订单接口（UI 调用） ---------- */
    add(pid) {
      const def = MD.P[pid];
      const o = { id: ++this.seq, pid, def, state: 'queued', props: [], dead: false, step: '', main: null, where: null, slot: -1,
        steps: MD.stepsFor ? MD.stepsFor(def).labels : [], stage: -1 };
      this.orders.push(o);
      this.emit();
      return o;
    }
    cancel(o) {
      if (o.state === 'queued') {
        o.state = 'cancelled';
      } else if (o.state === 'making') {
        o.state = 'cancelled'; o.dead = true;
        this._abortOwner(o);               // 立刻打断，_make 的 catch 会接着丢弃
      } else if (o.state === 'done') {
        o.state = 'cancelled'; o.dead = true;
        this.jobs.push(o);                 // 等当前订单做完后再去丢
      } else return;
      this.emit();
    }
    active() { return this.orders.filter((o) => ['queued', 'making', 'done'].includes(o.state)); }
    pickup() {  // 顾客取走出餐台上的成品
      for (const o of this.orders) {
        if (o.state !== 'done') continue;
        o.state = 'served';
        const p = o.main; if (!p) continue;
        if (o.slot >= 0) this.slots[o.slot] = null;
        const y0 = p.y;
        this._anim(null, 600, (k) => { p.y = y0 - k * 40; p.alpha = 1 - k; }, EASE.out).then(() => this._rm(p));
      }
      this.emit();
    }

    /* ---------- 计时器 ---------- */
    _anim(owner, ms, fn, ease) {
      const p = new Promise((res, rej) => {
        if (owner && owner.dead) return rej(new Abort());
        this.timers.push({ owner, ms: Math.max(1, ms), el: 0, fn, ease: ease || EASE.lin, res, rej });
      });
      // 有些动画（如 fly）先创建、稍后才 await；订单被取消时它可能在没人接的时候被 reject。
      // 挂一个空 catch 标记为“已处理”，真正 await 它的地方仍然会收到 Abort。
      p.catch(() => {});
      return p;
    }
    _abortOwner(o) {
      const keep = [];
      for (const tm of this.timers) { if (tm.owner === o) tm.rej(new Abort()); else keep.push(tm); }
      this.timers = keep;
      const w = this.worker; w.reach = null; w.moving = false;
    }
    tick(dtMs) {
      const n = Math.max(1, Math.ceil(this.speed));
      for (let i = 0; i < n; i++) this.update(Math.min(dtMs, 50) * this.speed / n);
    }
    update(dt) {
      this.t += dt;
      const done = [];
      for (const tm of this.timers) {
        tm.el += dt;
        const p = Math.min(1, tm.el / tm.ms);
        if (tm.fn) tm.fn(tm.ease(p), p);
        if (p >= 1) done.push(tm);
      }
      if (done.length) { this.timers = this.timers.filter((t) => !done.includes(t)); done.forEach((t) => t.res()); }

      const w = this.worker;
      if (w.moving) w.phase += dt * 0.016; else w.phase += dt * 0.004;
      w.sadT += (w.mood === 'sad' ? dt : -dt * 1.8); w.sadT = Math.max(0, Math.min(2000, w.sadT));
      // 手里的东西跟随到手的位置（拿东西时整个人抬 8px，道具也抬）
      const h = w.held;
      if (h) {
        const lift = 8;
        const tx = w.x + w.face * 4, ty = w.y - 56 * MD.WS - lift;
        const k = Math.min(1, dt * 0.018);
        h.x += (tx - h.x) * k; h.y += (ty - h.y) * k;
      }
      // 粒子
      for (const q of this.parts) {
        q.life -= dt; q.x += q.vx * dt / 1000; q.y += q.vy * dt / 1000; q.vy += (q.g || 0) * dt / 1000;
      }
      this.parts = this.parts.filter((q) => q.life > 0);
    }

    /* ---------- 粒子 / 特效 ---------- */
    puff(x, y, color, n = 8, o = {}) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = (o.speed || 60) * (0.4 + Math.random() * 0.8);
        this.parts.push({
          x: x + (Math.random() - 0.5) * (o.spread || 6), y: y + (Math.random() - 0.5) * (o.spread || 6),
          vx: Math.cos(a) * s * (o.flat || 1), vy: Math.sin(a) * s + (o.up || 0), g: o.g === undefined ? 120 : o.g,
          life: (o.life || 600) * (0.6 + Math.random() * 0.7), max: o.life || 600, color, size: o.size || 3,
        });
      }
    }
    fxAdd(fn) { const h = { fn }; this.fxs.push(h); return h; }
    fxRm(h) { this.fxs = this.fxs.filter((f) => f !== h); }
    _rm(p) { this.props = this.props.filter((x) => x !== p); if (p.order) p.order.props = p.order.props.filter((x) => x !== p); }

    /* ---------- 出餐台格子 ---------- */
    allocSlot(o) {
      const i = this.slots.findIndex((s) => !s);
      this.slots[i] = o; o.slot = i; return i;
    }

    /* ---------- 给配方用的动作 API ---------- */
    api(owner) {
      const E = this, w = this.worker;
      const A = {
        E, order: owner,
        say(t) { if (owner) { owner.step = t; E.emit(); } },
        stage(i) { if (owner && owner.steps && i > owner.stage) owner.stage = i; },   // 步骤状态栏：只增不减
        wait: (ms) => E._anim(owner, ms),
        anim: (ms, fn, ease) => E._anim(owner, ms, fn, ease),
        walk(target) {
          const to = typeof target === 'string' ? MD.ST[target].stand : target;
          const dx = to[0] - w.x, dy = to[1] - w.y, d = Math.hypot(dx, dy);
          if (d < 2) return Promise.resolve();
          const sx = w.x, sy = w.y, spd = MD.WALK * (w.mood === 'sad' ? 0.62 : 1);
          if (Math.abs(dx) > 5) w.face = dx > 0 ? 1 : -1;
          w.moving = true;
          return E._anim(owner, d / spd * 1000, (k) => { w.x = sx + dx * k; w.y = sy + dy * k; }, EASE.io)
            .then(() => { w.moving = false; }, (e) => { w.moving = false; throw e; });
        },
        reach(target, ms, onPeak) {
          const r = (w.reach = { tx: target[0], ty: target[1], k: 0 });
          if (Math.abs(target[0] - w.x) > 6) w.face = target[0] > w.x ? 1 : -1;
          let fired = false;
          return E._anim(owner, ms, (_, p) => {
            r.k = p < 0.35 ? EASE.out(p / 0.35) : p < 0.6 ? 1 : 1 - EASE.io((p - 0.6) / 0.4);
            if (!fired && p >= 0.35) { fired = true; if (onPeak) onPeak(); }
          }).then(() => { w.reach = null; }, (e) => { w.reach = null; throw e; });
        },
        spawn(p) { p.order = owner && owner.props ? owner : null; E.props.push(p); if (p.order) p.order.props.push(p); return p; },
        remove(p) { if (w.held === p) w.held = null; E._rm(p); },
        pick(p) { if (w.held && w.held !== p) { w.held.held = false; } w.held = p; p.held = true; },
        release(p) { if (w.held === p) w.held = null; p.held = false; },
        pop(p, big = 1.18) { const s0 = p.scale || 1; return E._anim(owner, 240, (k) => { p.scale = s0 * (k < 0.5 ? 0.9 + (big - 0.9) * (k / 0.5) : big - (big - 1) * ((k - 0.5) / 0.5)); }).catch(() => {}); },
        fly(p, to, ms, arc = 30, toScale) {
          const sx = p.x, sy = p.y, s0 = p.scale === undefined ? 1 : p.scale;
          return E._anim(owner, ms, (k) => {
            p.x = sx + (to[0] - sx) * k; p.y = sy + (to[1] - sy) * k - Math.sin(k * Math.PI) * arc;
            if (toScale !== undefined) p.scale = s0 + (toScale - s0) * k;
          }, EASE.io);
        },
        hand: (t) => MD.handPos(w, t, 1),
        puff: (...a) => E.puff(...a),
        fxAdd: (fn) => E.fxAdd(fn), fxRm: (h) => E.fxRm(h),
        /* 把手上的成品放到出餐台 */
        async deliver(p, finalW) {
          A.say('端到出餐台');
          await A.walk('pass');
          const i = E.allocSlot(owner);
          const [sx, sy] = MD.slotPos(i);
          let f;
          await A.reach([sx, sy - 10], 480, () => {
            A.release(p);
            const sc = finalW ? finalW / (p.w || finalW) : 1;
            f = A.fly(p, [sx, sy], 240, 22, sc);
          });
          await f;
          owner.main = p; owner.where = 'pass';
        },
      };
      return A;
    }

    /* ---------- 主循环 ---------- */
    async _loop() {
      for (;;) {
        const job = this._take();
        if (!job) { await this._idle(); continue; }
        try {
          if (job.kind === 'discard') await this._discard(job.order);
          else await this._make(job.order);
        } catch (e) { if (!(e instanceof Abort)) console.error(e); }
      }
    }
    /* 只读：有没有活要干（不会取走任务！_idle 会反复调用它） */
    _peek() {
      if (this.jobs.length) return true;
      return this.orders.some((x) => x.state === 'queued');
    }
    /* 真正取走下一个任务：丢弃任务优先于新订单 */
    _take() {
      if (this.jobs.length) return { kind: 'discard', order: this.jobs.shift() };
      const o = this.orders.find((x) => x.state === 'queued');
      return o ? { kind: 'make', order: o } : null;
    }
    async _idle() {
      const A = this.api(null);
      await A.wait(120);
      this.idleFor += 120;
      if (this.idleFor > 500 && !this._peek()) {
        const h = MD.ST.home.stand, w = this.worker;
        if (Math.hypot(w.x - h[0], w.y - h[1]) > 3) {
          // 回待命点：新订单一到就立刻停下，从当前位置接着干活
          const sx = w.x, sy = w.y, d = Math.hypot(h[0] - sx, h[1] - sy);
          w.moving = true; w.face = h[0] > sx ? 1 : -1;
          let tm = null;
          const pr = this._anim(null, d / MD.WALK * 1000, (k) => {
            if (this._peek()) { tm.el = tm.ms; return; }
            w.x = sx + (h[0] - sx) * k; w.y = sy + (h[1] - sy) * k;
          }, EASE.io);
          tm = this.timers[this.timers.length - 1];
          await pr;
          w.moving = false;
        }
      }
      if (this._peek()) this.idleFor = 0;
    }
    async _make(o) {
      this.cur = o; this.focus = o; o.state = 'making'; this.idleFor = 0;
      this.worker.bubble = { sprite: o.def.sprite };
      this.emit();
      try {
        await MD.recipes[o.def.kind](this.api(o), o, o.def);
        o.stage = o.steps.length;
        o.state = 'done'; o.step = '已出餐';
      } catch (e) {
        if (e instanceof Abort) { this.cur = null; await this._discard(o); }
        else throw e;
      } finally {
        this.cur = null;
        if (!this.worker.held) this.worker.bubble = null;
        this.emit();
      }
    }

    /* ---------- 伤心地丢掉 ---------- */
    async _discard(o) {
      const A = this.api({ dead: false, props: [] });   // 不可打断的 owner
      const w = this.worker;
      this.focus = o;
      w.mood = 'sad'; w.reach = null; w.moving = false;
      w.bubble = { sprite: o.def.sprite, cross: true };
      o.step = '丢弃中'; this.emit();
      await A.wait(500);
      let item = w.held && w.held.order === o ? w.held : null;
      if (!item) {
        const main = o.main && this.props.includes(o.main) ? o.main : null;
        // 其余散落的零件（正在飞的配料等）直接清掉
        for (const p of o.props.slice()) {
          if (p === main) continue;
          E_puffOut(this, p);
        }
        if (main) {
          let stand = MD.ST[o.where || 'board'].stand;
          if (o.where === 'pass') stand = [main.x + 44, main.y - 78];
          await A.walk(stand);
          await A.reach([main.x, main.y - 24], 520, () => { A.pick(main); });
          item = main;
        }
      } else {
        for (const p of o.props.slice()) if (p !== item) E_puffOut(this, p);
      }
      if (item) {
        await A.walk('trash');
        const tr = MD.ST.trash.spot;
        let f;
        await A.reach([tr[0] - 20, tr[1] - 10], 560, () => {
          A.release(item);
          f = A.fly(item, [tr[0], tr[1] + 6], 420, 46, 0.25);
        });
        await f;
        this.puff(tr[0], tr[1], '#8b8b8b', 10, { speed: 50, up: -40 });
        A.remove(item);
        await A.wait(250);
      } else {
        await A.wait(400);
      }
      if (o.slot >= 0) { this.slots[o.slot] = null; o.slot = -1; }
      w.bubble = null;
      await A.wait(350);
      w.mood = 'happy';
      o.state = 'trashed'; o.step = '';
      this.emit();
    }
  }
  function E_puffOut(E, p) {
    E.puff(p.x, p.y - 10, '#ffffff', 5, { speed: 40, life: 300 });
    E._rm(p);
    if (E.worker.held === p) E.worker.held = null;
  }

  MD.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
