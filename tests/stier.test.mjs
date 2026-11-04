import { checkA, checkB, checkC, evaluateSTier, sizePosition, rsiSeries, kelly, backtestStats } from '../src/strategy/sTier.js';
const ok = (c, m) => console.log(c ? 'ok  ' : 'FAIL', m);
const flat = (n, p = 100, v = 1000) => Array.from({ length: n }, (_, i) => ({ o: p, h: p + 0.2, l: p - 0.2, c: p + (i % 2 ? 0.05 : -0.05), v }));
// A
let cs = flat(30); cs.push({ o: 100, h: 101.6, l: 99.9, c: 101.5, v: 2500 });
let a = checkA(cs); ok(a.fired && a.metrics.volRatio === 2.5, `A fires: ${a.detail}`);
cs[cs.length - 1].v = 1500; ok(!checkA(cs).fired, 'A needs 2x volume');
cs[cs.length - 1].v = 2500; cs[cs.length - 1].c = 100.1; ok(!checkA(cs).fired, 'A needs breakout');
// B: decline then bullish bounce
let b = []; let p = 100; for (let i = 0; i < 25; i++) { const o = p; p -= 0.6; b.push({ o, h: o + 0.1, l: p - 0.1, c: p, v: 1000 }); }
b.push({ o: p, h: p + 0.9, l: p - 0.05, c: p + 0.8, v: 1500 });
const rb = checkB(b); ok(rb.fired, `B fires: ${rb.detail}`);
b[b.length - 1] = { o: p, h: p + 0.1, l: p - 0.5, c: p - 0.4, v: 1500 }; ok(!checkB(b).fired, 'B needs bullish bar');
// C
let c = []; let q = 103; for (let i = 0; i < 20; i++) c.push({ o: 100, h: 100.3, l: 99.7, c: 100, v: 900 });
c.push({ o: 103, h: 104.0, l: 102.9, c: 103.8, v: 3000 }, { o: 103.8, h: 103.9, l: 103.0, c: 103.1, v: 2000 }, { o: 103.1, h: 103.6, l: 103.0, c: 103.5, v: 1800 });
const ctx = { nowMin: 580, prevClose: 100, dayOpen: 103, indexGap: 0.004, sessionBars: 3 };
const rc = checkC(c, ctx); ok(rc.fired, `C fires: ${rc.detail} ${JSON.stringify(rc.metrics)}`);
ok(!checkC(c, { ...ctx, nowMin: 620 }).fired, 'C only 09:30-10:00');
ok(!checkC(c, { ...ctx, indexGap: 0.028 }).fired, 'C needs relative strength vs index');
// OR
const e = evaluateSTier(cs.slice(0, -1).concat([{ o: 100, h: 101.6, l: 99.9, c: 101.5, v: 2500 }]), { nowMin: 700 });
ok(e.fired && e.hits.map(h => h.id).join() === 'A', 'OR: A only fires → signal');
// kelly
const k = kelly('A', { trades: 0, wins: 0, avgWin: 0, avgLoss: 0 }); ok(Math.abs(k.f - (0.45 - 0.55 / 2)) < 1e-6, `kelly prior A f*=${k.f}`);
const s = sizePosition({ hits: [{ id: 'A' }], candles: cs, totalEquity: 50000, price: 100, currentWeight: 0, maxWeight: 0.15 });
ok(s.weight === Math.min(s.fullKelly * 0.5, 0.15) && s.qty === Math.floor(50000 * s.weight / 100), `size: f*=${s.fullKelly} weight=${s.weight} qty=${s.qty}`);
const s2 = sizePosition({ hits: [{ id: 'A' }], candles: cs, totalEquity: 50000, price: 100, currentWeight: 0.14, maxWeight: 0.15 });
ok(s2.weight === 0.01 && s2.cappedBy === 'limit', `capped by limit weight=${s2.weight}`);
// rsi sanity vs known: monotonic down → 0
ok(rsiSeries(Array.from({length:20},(_,i)=>100-i)).at(-1) === 0, 'rsi all-down = 0');
// backtest on random walk runs
let rw=[]; let x=100; for(let i=0;i<300;i++){const o=x; x*=1+(Math.random()-0.5)*0.01; rw.push({o,h:Math.max(o,x)*1.002,l:Math.min(o,x)*0.998,c:x,v:1000*(Math.random()<0.1?3:1)})}
const bt = backtestStats(rw,'A'); ok(bt.trades>=0, `backtest A on random walk: ${JSON.stringify(bt)}`);
