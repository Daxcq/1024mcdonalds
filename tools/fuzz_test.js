// 随机压力测试：随机加单/取消/取餐，检查引擎不崩、不残留。 node tools/fuzz_test.js [episodes]
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
global.window = undefined;
const files = (fs.readFileSync(path.join(root, 'tools', 'engine_files.txt'), 'utf8')).split(/\s+/).filter(Boolean);
for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), { filename: f });
const MD = globalThis.MD;
const flush = () => new Promise((r) => setImmediate(r));
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const errors = []; const origErr = console.error; console.error = (...a) => errors.push(a.map(String).join(' ').slice(0, 200));

async function episode(n) {
  const E = new MD.Engine(); const log = [];
  const ids = MD.LIST.map((p) => p.id);
  const T = 40000 + rnd() * 50000; let nextOp = 0;
  for (let t = 0; t < T; t += 32) {
    if (t >= nextOp) {
      nextOp = t + 300 + rnd() * 3500;
      const r = rnd(), act = E.active();
      if (r < 0.45 || !act.length) { const id = pick(ids); E.add(id); log.push(`+${id}@${(t / 1000).toFixed(1)}`); }
      else if (r < 0.85) { const o = pick(act); log.push(`x${o.def.id}(${o.state})@${(t / 1000).toFixed(1)}`); E.cancel(o); }
      else if (r < 0.92) { E.pickup(); log.push('pickup'); }
    }
    E.update(32); await flush();
  }
  // 排空：不再加单，等所有任务结束
  let guard = 0;
  while ((E.orders.some((o) => o.state === 'queued' || o.state === 'making') || E.jobs.length || E.worker.mood === 'sad') && guard++ < 6000) { E.update(32); await flush(); }
  for (let i = 0; i < 80; i++) { E.update(32); await flush(); }
  const bad = [];
  if (E.orders.some((o) => o.state === 'queued' || o.state === 'making')) bad.push('有订单卡住: ' + E.orders.filter((o) => ['queued', 'making'].includes(o.state)).map((o) => o.def.id + ':' + o.state));
  if (E.fxs.length) bad.push('残留特效 fxs=' + E.fxs.length);
  if (E.worker.mood !== 'happy') bad.push('店员一直伤心');
  if (E.worker.held) bad.push('手里还拿着东西');
  const keep = new Set(E.orders.filter((o) => o.state === 'done').map((o) => o.main));
  const stray = E.props.filter((p) => !keep.has(p));
  if (stray.length) bad.push('残留道具 ' + stray.map((p) => p.key || p.type).join(','));
  const lost = E.orders.filter((o) => o.state === 'cancelled' && o.dead);
  if (lost.length) bad.push('取消后没处理完 ' + lost.map((o) => o.def.id));
  const leakSlots = E.slots.filter((s) => s && s.state !== 'done');
  if (leakSlots.length) bad.push('出餐位被占用但订单不是 done: ' + leakSlots.map((s) => s.def.id + ':' + s.state));
  return { bad, log, E };
}

(async () => {
  const N = +process.argv[2] || 40; let fails = 0;
  for (let i = 0; i < N; i++) {
    errors.length = 0;
    const r = await episode(i);
    const all = r.bad.concat(errors.map((e) => '异常: ' + e));
    if (all.length) { fails++; console.log(`FAIL #${i}`, all.slice(0, 6).join(' | ')); if (fails <= 2) console.log('  ops:', r.log.slice(-14).join(' ')); }
  }
  console.log(fails ? `${fails}/${N} episodes FAILED` : `ALL ${N} episodes OK`);
  process.exit(fails ? 1 : 0);
})();
