const fs=require('fs'),path=require('path'),vm=require('vm');const root=__dirname+'/../';global.window=undefined;
for(const f of['data','menu','engine','recipes'])vm.runInThisContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'));
const MD=globalThis.MD,flush=()=>new Promise(r=>setImmediate(r));
async function run(E,ms,until){for(let t=0;t<ms;t+=16){E.tick(16);await flush();if(until&&until())return t;}return ms;}
(async()=>{
const E=new MD.Engine();
const a=E.add('cola'),b=E.add('burger'),c=E.add('fries_m');
await run(E,2000);
console.log('before cancel:',E.orders.map(o=>o.def.name+':'+o.state).join(' | '));
E.cancel(b);
await run(E,100);
console.log('after cancel b:',E.orders.map(o=>o.def.name+':'+o.state).join(' | '),'jobs',E.jobs.length);
E.cancel(a);
await run(E,100);
console.log('after cancel a:',E.orders.map(o=>o.def.name+':'+o.state).join(' | '),'jobs',E.jobs.length);
await run(E,25000,()=>c.state==='done');
console.log('final:',E.orders.map(o=>o.def.name+':'+o.state).join(' | '));
})();
