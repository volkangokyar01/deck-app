// Script files as wheel entries: the desktop app runs them instead of opening them in an editor
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const main = fs.readFileSync(path.join(__dirname, '../../app/main.js'), 'utf8');
const code = main.slice(main.indexOf('// Windows: everything is a direct system call'), main.indexOf('async function launch(e)'));
function load(plat) {
  const calls = [];
  const ctx = vm.createContext({ path: plat === 'win' ? path.win32 : path.posix, fs: { existsSync: () => true },
    shell: { openPath: async p => { calls.push(['openPath', p]); return ''; }, openExternal: async () => {} },
    detached: async (cmd, args, opts) => { calls.push([cmd, args, opts]); return { ok: true }; },
    run: async (cmd, args) => { calls.push([cmd, args]); return { code: 0, stdout: '', stderr: '' }; },
    ok: how => ({ ok: true, how }), fail: error => ({ ok: false, error }), isUrl: s => /^[a-z][a-z0-9+.-]+:/i.test(s) && !/^[a-z]:[\\/]/i.test(s),
    findStartApp: async () => null });
  vm.runInContext(code + ';this.launchWin=launchWin;this.launchMac=launchMac;', ctx);
  return { ctx, calls };
}
test('Windows: .ps1 runs in PowerShell, .bat / .cmd through start, .vbs in wscript', async () => {
  const w = load('win');
  await w.ctx.launchWin({ path: 'C:\\x\\a.ps1' });
  assert.equal(w.calls[0][0], 'powershell.exe'); same(w.calls[0][1].slice(-2), ['-File', 'C:\\x\\a.ps1']);
  await w.ctx.launchWin({ path: 'C:\\x\\a.ps1', bg: true }); assert.ok(w.calls[1][1].includes('Hidden'));
  await w.ctx.launchWin({ path: 'C:\\x\\b.bat' }); assert.equal(w.calls[2][0], 'cmd.exe'); assert.match(w.calls[2][1][0], /start "" \/D "C:\\x" "C:\\x\\b.bat"/);
  await w.ctx.launchWin({ path: 'C:\\x\\c.vbs' }); same(w.calls[3].slice(0, 2), ['wscript.exe', ['C:\\x\\c.vbs']]);
  await w.ctx.launchWin({ path: 'C:\\x\\doc.pdf' }); same(w.calls[4], ['openPath', 'C:\\x\\doc.pdf']);
});
test('macOS: shell / Python / AppleScript run without Terminal, .command and apps go through open', async () => {
  const m = load('mac');
  for (const [file, cmd] of [['/u/a.sh', '/bin/bash'], ['/u/a.zsh', '/bin/zsh'], ['/u/a.py', '/usr/bin/python3'], ['/u/a.scpt', '/usr/bin/osascript']]) {
    m.calls.length = 0; await m.ctx.launchMac({ mac: file }); same(m.calls[0].slice(0, 2), [cmd, [file]]); assert.equal(m.calls[0][2].cwd, '/u');
  }
  m.calls.length = 0; await m.ctx.launchMac({ mac: '/u/a.command' }); same(m.calls[0], ['/usr/bin/open', ['/u/a.command']]);
  m.calls.length = 0; await m.ctx.launchMac({ mac: '/Applications/X.app', bg: true }); same(m.calls[0], ['/usr/bin/open', ['-g', '/Applications/X.app']]);
});
