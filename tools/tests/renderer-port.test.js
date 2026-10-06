const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const body = fs.readFileSync(path.join(__dirname, '../../web/body.html'), 'utf8');
const companion = fs.readFileSync(path.join(__dirname, '../../app/companion.js'), 'utf8');
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const state = (key, playing = true) => ({ media: { player: 'spotify', title: key, playing, artKey: key } });
function fakePort() {
  let controller; const written = [];
  const p = { readable: new ReadableStream({ start(c) { controller = c; } }),
    writable: new WritableStream({ write(b) { written.push(new TextDecoder().decode(b)); } }),
    push: line => controller.enqueue(new TextEncoder().encode(line + '\n')), close: () => controller.close(),
    lines: () => written.flatMap(s => s.trim().split('\n').map(JSON.parse)) };
  return p;
}
async function setup(overrides = {}) {
  const controls = [], errors = [], timers = [], ports = [], reads = [];
  const deck = { hostState: async () => ({}), mediaArt: async () => null, mediaControl: async (...a) => { controls.push(a); return { ok: true }; }, sysSet: async () => {}, ...overrides };
  const ctx = vm.createContext({ ReadableStream, WritableStream, TextDecoderStream, TextEncoder, performance, queueMicrotask,
    console: { log() {}, error: (...a) => errors.push(a) }, setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimeout() {}, deck });
  vm.runInContext(`
    const logElement={childNodes:[],append(e){this.childNodes.push(e)},get firstChild(){return {remove:()=>this.childNodes.shift()}},scrollTop:0,scrollHeight:0};
    const $=s=>s==='#log'?logElement:{}, el=(tag,attrs,text)=>({tag,attrs,text});
    const document={querySelector:()=>null}, toast=()=>{}, renderStatus=()=>{}, drawScreen=()=>{}, renderCtlMap=()=>{}, renderEditor=()=>{}, simulateLaunch=()=>{}, setMediaArt=()=>{}, wheel=()=>[{id:'__media',page:'media'},{id:'__home',page:'home'}];
    const pageState={}, cfg={pages:{media:{enabled:true,launch:'none'},system:{enabled:true}}};
    let sel=0, deviceInfo={fw:'1.6.2'}, direct=true, busy=false, updateState=null;
    const window={deck}; this.logElement=logElement;
  `, ctx);
  const serial = body.slice(body.indexOf('/* ---------- Web Serial ---------- */'), body.indexOf('/* Bluetooth data channel'));
  vm.runInContext(serial + ';this.attach=p=>{port=p;writer=p.writable.getWriter();window.onDeckSerialOpen?.();return readLoop();};', ctx);
  vm.runInContext(body.split('\n').find(s => s.startsWith('const hostDemo=')), ctx);
  vm.runInContext(companion.slice(companion.indexOf('  /* ---- media + volume/brightness pages'), companion.indexOf('  /* ---- per-app direct targets')) + ';this.h={runMedia,runSys,pushArt,mediaCadence,get deckPage(){return deckPage}};', ctx);
  await tick();
  async function attach(p = fakePort()) { ports.push(p); reads.push(ctx.attach(p)); await tick(); return p; }
  const p = await attach();
  return { ctx, p, deck, controls, errors, timers, attach, async close() { for (const p of ports) p.close(); await Promise.all(reads); } };
}
test('real readLoop handles boot, status, selection and media control', async () => {
  const s = await setup();
  try {
    for (const line of ['boot text', '{"evt":"status","fw":"1.6.2"}', '{"evt":"select","app":"media"}', '{"evt":"media","action":"next","player":"spotify"}']) s.p.push(line);
    await tick(); assert.equal(s.controls.length, 1); assert.deepEqual(s.controls[0].slice(0, 2), ['next', 'spotify']);
    assert.equal(s.controls[0][2].launch, 'none'); assert.ok(s.ctx.logElement.childNodes.length); assert.equal(s.ctx.h.deckPage, 'media');
  } finally { await s.close(); }
});
test('real send resolves its matching response', async () => {
  const s = await setup();
  try {
    const answer = s.ctx.send({ cmd: 'hello' }); await tick(); const sent = s.p.lines().find(m => m.cmd === 'hello');
    s.p.push(JSON.stringify({ id: sent.id, ok: true, fw: '1.6.2' })); assert.equal((await answer).fw, '1.6.2');
  } finally { await s.close(); }
});
test('cover loading follows the newest media without blocking its lane', async () => {
  const k1 = deferred(), k2 = deferred(); let key = 'k1';
  const s = await setup({ hostState: async () => state(key), mediaArt: k => k === 'k1' ? k1.promise : k2.promise });
  try {
    await s.ctx.h.runMedia(); key = 'k2'; await s.ctx.h.runMedia();
    k1.resolve({ key: 'k1', data: 'old' }); await tick(); k2.resolve({ key: 'k2', data: 'new' }); await tick();
    const lines = s.p.lines(); assert.ok(!lines.some(m => m.cmd === 'media_art' && m.key === 'k1'));
    assert.deepEqual(lines.filter(m => m.cmd === 'media' || m.data).map(m => [m.cmd, m.artKey || m.key]), [['media', 'k1'], ['media', 'k2'], ['media_art', 'k2']]);
  } finally { await s.close(); }
});
test('a press invalidates the pre-press answer and polls again', async () => {
  const a = deferred(); let calls = 0;
  const s = await setup({ hostState: () => ++calls === 1 ? a.promise : Promise.resolve(state('', true)) });
  try {
    const run = s.ctx.h.runMedia(); await tick(); s.p.push('{"evt":"media","action":"play_pause"}'); await tick();
    a.resolve(state('', false)); await run; await tick();
    const media = s.p.lines().filter(m => m.cmd === 'media'); assert.ok(media.length); assert.ok(media.every(m => m.playing));
    assert.equal(s.controls[0][0], 'play_pause');
  } finally { await s.close(); }
});
test('a reconnect drops a pending cover on both ports', async () => {
  const art = deferred(), s = await setup({ hostState: async () => state('k1'), mediaArt: () => art.promise });
  try {
    await s.ctx.h.runMedia(); const next = await s.attach(); art.resolve({ key: 'k1', data: 'old' }); await tick();
    assert.ok(![...s.p.lines(), ...next.lines()].some(m => m.cmd === 'media_art' && m.data));
  } finally { await s.close(); }
});
test('cadence follows selection, playback and Bluetooth', async () => {
  const s = await setup();
  try {
    assert.equal(s.ctx.h.mediaCadence(), 1000); s.p.push('{"evt":"select","app":"media"}'); await tick();
    assert.equal(s.ctx.h.mediaCadence(), 500); vm.runInContext('hostDemo.media.playing=false', s.ctx); assert.equal(s.ctx.h.mediaCadence(), 1000);
    s.p.push('{"evt":"select","app":"home"}'); await tick(); assert.equal(s.ctx.h.mediaCadence(), 2000);
    s.p.isBle = true; vm.runInContext('hostDemo.media.playing=true', s.ctx); s.p.push('{"evt":"select","app":"media"}'); await tick(); assert.equal(s.ctx.h.mediaCadence(), 1000);
  } finally { await s.close(); }
});
