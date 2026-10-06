const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMailWatcher, createTracker, normalizeSettings, parseBadge } = require('../../app/mail');

test('settings: defaults on, 10 s, subject; unknown durations fall back', () => {
  assert.deepEqual(normalizeSettings(), { enabled: true, seconds: 10, subject: true });
  assert.deepEqual(normalizeSettings({ enabled: false, seconds: '30', subject: false }), { enabled: false, seconds: 30, subject: false });
  assert.equal(normalizeSettings({ seconds: 7 }).seconds, 10);
  assert.equal(normalizeSettings({ seconds: -5 }).seconds, 10);
});

test('Dock badge: count, none, 99+, dot', () => {
  assert.equal(parseBadge('"StatusLabel"={ "label"="3" }\n'), 3);
  assert.equal(parseBadge('"StatusLabel"=[ NULL ]'), 0);
  assert.equal(parseBadge(''), 0);
  assert.equal(parseBadge('"StatusLabel"={ "label"="" }'), 0);
  assert.equal(parseBadge('"StatusLabel"={ "label"="99+" }'), 99);
  assert.equal(parseBadge('"StatusLabel"={ "label"="•" }'), 1);
});

test('tracker: baseline first, increases only, warm-up after Outlook starts', () => {
  let t = 0;
  const track = createTracker({ now: () => t, warmupMs: 20000 });
  assert.equal(track({ running: true, unread: 4 }), 0);       // already running when we start: baseline, no warm-up
  t += 3000; assert.equal(track({ running: true, unread: 6 }), 2);
  t += 3000; assert.equal(track({ running: true, unread: 5 }), 0);
  t += 3000; assert.equal(track({ running: true, unread: null }), 0);
  t += 3000; assert.equal(track({ running: true, unread: 6 }), 1);
  t += 3000; assert.equal(track({ running: false }), 0);        // Outlook closed
  t += 3000; assert.equal(track({ running: true, unread: 0 }), 0);
  t += 3000; assert.equal(track({ running: true, unread: 12 }), 0);   // startup sync is not new mail
  t += 20000; assert.equal(track({ running: true, unread: 13 }), 1);
});

function fakeTimers() {
  const q = [];
  return { q, timers: { setTimeout: (fn, ms) => { const h = { fn, ms }; q.push(h); return h; }, clearTimeout: h => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); } },
           async next() { const h = q.shift(); assert.ok(h, 'no timer queued'); await h.fn(); } };
}
const flush = () => new Promise(r => setImmediate(r));

test('macOS: polls lsappinfo only while linked and on; a higher badge sends a note without subject', async () => {
  let badge = 2, running = true;
  const calls = [], notes = [];
  const run = async (cmd, args) => {
    calls.push(args[2]);
    if (args[2] === 'pid') return { code: 0, stdout: running ? '"pid"=812\n' : '', stderr: '' };
    return { code: 0, stdout: running ? `"StatusLabel"={ "label"="${badge}" }` : '', stderr: '' };
  };
  const ft = fakeTimers();
  const w = createMailWatcher({ platform: 'darwin', run, onMail: m => notes.push(m), timers: ft.timers, now: () => 0 });
  w.configure({ seconds: 15 });
  await flush(); assert.equal(calls.length, 0);                    // no deck yet: nothing runs
  w.setLinked(true); await flush();
  assert.deepEqual(calls.sort(), ['StatusLabel', 'pid']);
  assert.equal(w.state().unread, 2); assert.equal(w.state().running, true);
  badge = 3; await ft.next(); await flush();
  assert.deepEqual(notes, [{ subject: '', unread: 3, fresh: 1, ms: 15000 }]);
  running = false; await ft.next(); await flush();
  assert.equal(w.state().running, false);
  w.setLinked(false); assert.equal(ft.q.length, 0); assert.equal(w.state().active, false);
});

test('Windows: subject only after the count goes up, folded for the deck fonts; disabling stops the helper', async () => {
  const calls = [], notes = [];
  let unread = 1, stopped = 0;
  const helper = {
    call: async (op, args) => { calls.push(args.top); return { ok: true, r: { running: true, unread, ...(args.top ? { subject: 'Toplantı “özet” — café' } : {}) } }; },
    stop: () => { stopped++; }
  };
  const ft = fakeTimers();
  const w = createMailWatcher({ platform: 'win32', helper, onMail: m => notes.push(m), timers: ft.timers, now: () => 0 });
  w.configure({}); w.setLinked(true); await flush();
  assert.deepEqual(calls, [false]);
  unread = 2; await ft.next(); await flush();
  assert.deepEqual(calls, [false, false, true]);
  assert.deepEqual(notes, [{ subject: 'Toplantı "özet" - cafe', unread: 2, fresh: 1, ms: 10000 }]);
  w.configure({ subject: false }); unread = 4; await ft.next(); await flush();
  assert.equal(notes[1].subject, ''); assert.equal(notes[1].fresh, 2); assert.equal(calls.at(-1), false);
  w.configure({ enabled: false }); assert.equal(stopped, 1); assert.equal(ft.q.length, 0);
});

test('Windows: helper errors keep the baseline; Outlook not attachable yet is not new mail', async () => {
  const notes = [];
  const replies = [{ ok: true, r: { running: true, unread: 3 } }, { ok: false, error: 'timeout' },
    { ok: true, r: { running: true, error: 'Operation unavailable' } }, { ok: true, r: { running: true, unread: 3 } }, { ok: true, r: { running: true, unread: 4 } }];
  const helper = { call: async () => replies.shift(), stop() {} };
  const ft = fakeTimers();
  const w = createMailWatcher({ platform: 'win32', helper, onMail: m => notes.push(m), timers: ft.timers, now: () => 0 });
  w.configure({ subject: false }); w.setLinked(true); await flush();
  await ft.next(); await flush(); assert.equal(w.state().error, 'timeout');
  await ft.next(); await flush(); await ft.next(); await flush();
  assert.equal(notes.length, 0);
  await ft.next(); await flush();
  assert.equal(notes.length, 1); assert.equal(notes[0].unread, 4);
});

test('unsupported platforms never poll', async () => {
  let calls = 0;
  const w = createMailWatcher({ platform: 'linux', run: async () => { calls++; return { code: 0, stdout: '' }; }, timers: fakeTimers().timers });
  w.configure({}); w.setLinked(true); await flush();
  assert.equal(calls, 0); assert.equal(w.state().active, false);
});
