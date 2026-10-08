const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTrayUpdate, openLocationSettings } = require('../../app/main-actions');

function tray(state, response = 0) {
  const calls = [];
  const updater = { getState: () => state,
    check: async options => { calls.push(['check', options]); return state = { phase: 'available', available: true }; },
    apply: async () => { calls.push('apply'); return { phase: 'installing' }; } };
  const run = createTrayUpdate({ updater, refreshTray: () => calls.push('refresh'),
    dialog: { showMessageBox: async o => { calls.push(o); return { response }; } } });
  return { run, calls, updater };
}
test('tray applies in main after native confirmation, with no renderer dependency', async () => {
  const t = tray({ phase: 'available', available: true });
  await t.run();
  assert.ok(t.calls.includes('apply')); assert.equal(t.calls.filter(x => x?.[0] === 'check').length, 0);
  const question = t.calls.find(x => x.type === 'question');
  assert.equal(question.message, 'Game Deck güncellensin mi? Uygulama yeniden başlar.');
  assert.deepEqual(question.buttons, ['Güncelle', 'Vazgeç']); assert.equal(question.cancelId, 1);
});
test('tray manual check refreshes label and offers installation; cancel and installer do not apply', async () => {
  const t = tray({ phase: 'idle', available: false }, 1); await t.run();
  assert.deepEqual(t.calls[0], ['check', { manual: true }]);
  assert.equal(t.calls[1], 'refresh'); assert.ok(t.calls.some(x => x.type === 'question')); assert.ok(!t.calls.includes('apply'));
  const i = tray({ phase: 'available', available: true, needsInstaller: true, message: 'Kurulum betiğini yeniden çalıştır.' });
  await i.run(); assert.ok(!i.calls.includes('apply')); assert.equal(i.calls.find(x => x.type === 'info').message, 'Kurulum betiğini yeniden çalıştır.');
});
test('tray serializes clicks and reports apply/check failures natively', async () => {
  const t = tray({ phase: 'available', available: true });
  t.updater.apply = async () => ({ phase: 'error', message: 'İndirme başarısız' });
  await Promise.all([t.run(), t.run()]);
  assert.equal(t.calls.filter(x => x.type === 'question').length, 1);
  assert.ok(t.calls.some(x => x.message === 'İndirme başarısız'));
  const failed = tray({ phase: 'idle', available: false });
  failed.updater.check = async () => { throw new Error('Ağ yok'); };
  await failed.run(); assert.ok(failed.calls.some(x => x.message === 'Güncelleme yapılamadı: Ağ yok'));
});

test('location settings opens only the exact platform URL, ignoring renderer arguments', async () => {
  const urls = [], shell = { openExternal: async url => urls.push(url) };
  await openLocationSettings('darwin', shell, 'https://bad.test');
  await openLocationSettings('win32', shell);
  await assert.rejects(openLocationSettings('linux', shell));
  assert.deepEqual(urls, ['x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices', 'ms-settings:privacy-location']);
});
