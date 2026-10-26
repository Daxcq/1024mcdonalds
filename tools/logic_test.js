// Node 逻辑测试：node tools/logic_test.js
// 引擎是 async 状态机，每个 tick 后要让出一次事件循环，微任务才会推进。
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
global.window = undefined;
for (const f of ['data', 'menu', 'engine', 'recipes']) vm.runInThisContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), { filename: f });
const MD = globalThis.MD;
const flush = () => new Promise((r) => setImmediate(r));
async function run(E, ms, until, each) {
  for (let t = 0; t < ms; t += 16) {
    E.tick(16); await flush();
    if (each) each(t);
    if (until && until()) return t;
  }
  return ms;
}
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

(async () => {
  // 1. 顺序：可乐 -> 汉堡，可乐没完不能开始汉堡
  {
    const E = new MD.Engine(); const a = E.add('cola'), b = E.add('burger');
    let overlap = false, aDoneAt = 0, bStartAt = 0;
    await run(E, 150000, () => a.state === 'done' && b.state === 'done', (t) => {
      if (a.state === 'making' && b.state === 'making') overlap = true;
      if (a.state === 'done' && !aDoneAt) aDoneAt = t;
      if (b.state === 'making' && !bStartAt) bStartAt = t;
    });
    ok(a.state === 'done' && b.state === 'done', `1a 可乐+汉堡都做完 (可乐完成 ${(aDoneAt / 1000).toFixed(1)}s, 汉堡开始 ${(bStartAt / 1000).toFixed(1)}s)`);
    ok(!overlap && bStartAt >= aDoneAt, '1b 严格先后，不并行');
    ok(a.slot >= 0 && b.slot >= 0 && a.slot !== b.slot, '1c 两份占不同出餐位');
  }
  // 2. 做可乐途中取消 -> 先伤心丢掉，再做汉堡
  {
    const E = new MD.Engine(); const a = E.add('cola'), b = E.add('burger');
    await run(E, 100000, () => a.state === 'making' && a.main && a.main.level > 0.4);
    const lvl = a.main ? a.main.level : -1; E.cancel(a);
    let sawSad = false, sawTrash = false, burgerBeforeTrash = false;
    await run(E, 150000, () => b.state === 'done', () => {
      if (E.worker.mood === 'sad') sawSad = true;
      if (a.state === 'trashed') sawTrash = true;
      if (b.state === 'making' && !sawTrash) burgerBeforeTrash = true;
    });
    ok(lvl > 0.4 && sawSad, `2a 取消时杯子正在接(${lvl.toFixed(2)})，店员变伤心`);
    ok(sawTrash && !burgerBeforeTrash, '2b 先丢掉可乐(trashed)，之后才开始汉堡');
    ok(E.props.filter((p) => p.order === a).length === 0, '2c 可乐相关道具已清空');
    ok(b.state === 'done' && E.worker.mood === 'happy', '2d 汉堡做完，店员恢复心情');
  }
  // 3. 取消排队中的：无伤心动作；其余照常
  {
    const E = new MD.Engine(); const a = E.add('cola'), b = E.add('burger'), c = E.add('fries_m');
    await run(E, 5000); E.cancel(b);
    let sad = false;
    await run(E, 150000, () => c.state === 'done', () => { if (E.worker.mood === 'sad') sad = true; });
    ok(b.state === 'cancelled' && a.state === 'done' && c.state === 'done' && !sad, '3 取消排队中的汉堡：不触发伤心，其余照常');
  }
  // 4. 取消已完成的：做完手头的再去丢
  {
    const E = new MD.Engine(); const a = E.add('cola');
    await run(E, 100000, () => a.state === 'done'); const b = E.add('orange');
    await run(E, 1500); E.cancel(a);
    await run(E, 150000, () => a.state === 'trashed' && b.state === 'done');
    ok(a.state === 'trashed' && b.state === 'done' && E.slots.every((s) => s !== a), '4 取消已完成的可乐：已开始的橙汁做完，再去出餐台丢可乐');
  }
  // 5. 汉堡中途取消
  {
    const E = new MD.Engine(); const a = E.add('bigmac'), b = E.add('cola');
    await run(E, 100000, () => a.state === 'making' && a.main && a.main.layers && a.main.layers.length >= 4);
    E.cancel(a);
    await run(E, 150000, () => b.state === 'done');
    ok(a.state === 'trashed' && b.state === 'done' && !E.props.some((p) => p.order === a), '5 巨无霸做到一半取消：半成品被丢掉，继续做可乐');
  }
  // 6. 全菜单各做一遍 + 验证实时卡路里累加
  for (const p of MD.LIST) {
    const E = new MD.Engine(); const o = E.add(p.id);
    const seenKcals = new Set();
    let sawPop = false;
    const t = await run(E, 200000, () => o.state === 'done', () => {
      if (o.liveNutri && o.liveNutri.kcal > 0) seenKcals.add(o.liveNutri.kcal);
      if (E.calPops && E.calPops.length > 0) sawPop = true;
    });
    const kcalMatch = o.liveNutri.kcal === o.totalNutri.kcal && (p.cat !== 'burger' || seenKcals.size >= 4);
    ok(o.state === 'done' && o.slot >= 0 && kcalMatch && (o.totalNutri.kcal === 0 || sawPop), `6 ${p.id.padEnd(16)} ${(t / 1000).toFixed(1)}s (${o.liveNutri.kcal} kcal)`);
  }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
