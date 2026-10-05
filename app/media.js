// Media players, volume and brightness for the deck's "Medya" and "Ses ve parlaklık" pages.
//   Windows: a long-running PowerShell helper (win-helper.ps1): media sessions, Core Audio, WMI / DDC-CI.
//   macOS:   AppleScript (Spotify, Music, browser tabs, volume) and JXA for the built-in display's brightness.
const path = require('path');
const cp = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const NAMES = { spotify: 'Spotify', music: 'Apple Music', ytmusic: 'YouTube Music' };

function run(cmd, args, timeout = 6000, input) {
  return new Promise(res => {
    const ch = cp.execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
      res({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
    if (input != null) { ch.stdin.end(input); }
  });
}

// The deck's fonts have ASCII + Turkish letters only: fold everything else (é → e, “ → ")
const EXTRA = new Set([...'°·ÇÖÜçöüĞğİıŞş…‹›']);
const okCh = c => (c >= ' ' && c <= '~') || EXTRA.has(c);
function devText(s, max = 90) {
  let o = '';
  for (const ch of String(s || '')) {
    if (okCh(ch)) { o += ch; continue; }
    if (/[‘’´`]/.test(ch)) { o += "'"; continue; }
    if (/[“”„]/.test(ch)) { o += '"'; continue; }
    if (/[–—−]/.test(ch)) { o += '-'; continue; }
    const b = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (b && [...b].every(okCh)) o += b;
  }
  return o.replace(/\s+/g, ' ').trim().slice(0, max);
}
const num = s => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : -1; };

let lastPlayer = '';            // remembered for "auto" when nothing is playing
function pick(cands, target) {
  let list = cands;
  if (target && target !== 'auto') {
    list = cands.filter(c => c.player === target);
    if (target === 'ytmusic') list.sort((a, b) => (b.native ? 1 : 0) - (a.native ? 1 : 0));
  }
  if (!list.length) return null;
  const order = { spotify: 0, music: 1, ytmusic: 2, other: 3 };
  const byPrio = (a, b) => (order[a.player] ?? 9) - (order[b.player] ?? 9);
  const playing = list.filter(c => c.playing).sort(byPrio);
  if (playing.length) return playing[0];
  if (target === 'auto' || !target) {
    const last = list.find(c => c.player === lastPlayer); if (last) return last;
    const cur = list.find(c => c.current); if (cur) return cur;
  }
  return list.slice().sort(byPrio)[0];
}
function shape(c) {
  if (!c) return { player: '', name: '', title: '', artist: '', playing: false, pos: -1, dur: -1, ctl: 'keys', artKey: '' };
  if (c.playing) lastPlayer = c.player;
  return { player: c.player, name: devText(c.name, 30), title: devText(c.title), artist: devText(c.artist), playing: !!c.playing,
           pos: c.pos >= 0 ? Math.round(c.pos * 10) / 10 : -1, dur: c.dur > 0 ? Math.round(c.dur * 10) / 10 : -1, ctl: c.ctl || 'app', artKey: art.request(c) };
}

/* ===================== Windows ===================== */
function helperClient() {
  let helper = null, helperBuf = '', helperQ = [], helperReady = null, helperId = 0;
  function startHelper() {
    if (helper) return helperReady;
    helperBuf = ''; helperQ = [];
    helper = cp.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'win-helper.ps1')],
                      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let readyRes; helperReady = new Promise(r => { readyRes = r; });
    const t = setTimeout(() => readyRes(false), 20000);
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', d => {
      helperBuf += d; let i;
      while ((i = helperBuf.indexOf('\n')) >= 0) {
        const line = helperBuf.slice(0, i).trim(); helperBuf = helperBuf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch (e) { continue; }
        if (m.ready) { clearTimeout(t); readyRes(true); continue; }
        const p = helperQ.shift(); if (p) { clearTimeout(p.timer); p.res(m); }
      }
    });
    const dead = () => { helper = null; readyRes(false); for (const p of helperQ) { clearTimeout(p.timer); p.res({ ok: false, error: 'helper exited' }); } helperQ = []; };
    helper.on('exit', dead); helper.on('error', dead);
    return helperReady;
  }
  async function call(op, args = {}, timeout = 6000) {
    if (!IS_WIN) return { ok: false, error: 'not windows' };
    if (!(await startHelper()) || !helper) return { ok: false, error: 'helper not running' };
    return new Promise(res => {
      const p = { res, timer: setTimeout(() => { try { helper && helper.kill(); } catch (e) {} res({ ok: false, error: 'timeout' }); }, timeout) };
      helperQ.push(p);
      try { helper.stdin.write(JSON.stringify({ id: ++helperId, op, ...args }) + '\n'); } catch (e) { clearTimeout(p.timer); res({ ok: false, error: e.message }); }
    });
  }
  function stop() { try { helper && helper.kill(); } catch (e) {} }
  return { call, stop };
}
const hostHelper = helperClient(), artHelper = helperClient();
// Thumbnail reads use their own helper so WinRT artwork never holds up the normal poll.
const ps = (op, args, timeout) => (op === 'art' ? artHelper : hostHelper).call(op, args, timeout);
const art = require('./art').create({ run, ps });
function winClass(app) {
  const a = String(app || '').toLowerCase();
  if (/spotify/.test(a)) return ['spotify', 'Spotify', true];
  if (/applemusic|apple\.music|itunes|appleinc/.test(a)) return ['music', 'Apple Music', true];
  if (/youtube|th-ch/.test(a)) return ['ytmusic', 'YouTube Music', true];
  if (/chrome|msedge|edge|brave|opera|firefox|308046b0af4a39cb|vivaldi|arc/.test(a)) return ['ytmusic', 'Tarayıcı', false];
  return ['other', String(app || '').split(/[!\\.]/).filter(Boolean).pop() || 'Medya', true];
}
async function winMedia(target) {
  const r = await ps('media');
  if (!r.ok) return null;
  const list = Array.isArray(r.r) ? r.r : r.r ? [r.r] : [];
  const now = Date.now();
  const cands = list.map(s => {
    const [player, name, native] = winClass(s.app);
    const playing = s.status === 'Playing';
    let pos = Number(s.pos) || 0, dur = Number(s.dur) || 0;
    if (playing && s.updated > 0) pos = Math.min(dur || 1e9, pos + Math.max(0, now - s.updated) / 1000);
    return { player, name, native, app: s.app, title: s.title, artist: s.artist, playing, pos: dur > 0 ? pos : -1, dur, current: !!s.current, ctl: 'app' };
  });
  return cands;
}

/* ===================== macOS ===================== */
const MAC_APPS = { spotify: 'Spotify', music: 'Music' };
const MAC_BROWSERS = [['Google Chrome', 'chrome'], ['Microsoft Edge', 'chrome'], ['Brave Browser', 'chrome'], ['Safari', 'safari']];
async function macRunning() {
  const r = await run('ps', ['-axco', 'command'], 3000);
  return new Set(r.stdout.split('\n').map(s => s.trim()).filter(Boolean));
}
function asPlayer(id, app, durDiv) {
  // variable names carry a vd prefix: Music's dictionary reserves short words such as "st"
  return `try
  tell application "${app}"
    set vdState to player state as text
    set vdLine to "${id}" & tab & vdState
    try
      set vdTrack to current track
      set vdLine to vdLine & tab & (name of vdTrack) & tab & (artist of vdTrack) & tab & (player position as text) & tab & ((duration of vdTrack) / ${durDiv} as text)
    end try
    set vdOut to vdOut & vdLine & linefeed
  end tell
end try
`;
}
function asBrowser(app, kind) {
  const title = kind === 'safari' ? 'name' : 'title';
  return `try
  tell application "${app}"
    repeat with vdWin in windows
      repeat with vdTab in tabs of vdWin
        if (URL of vdTab) contains "music.youtube.com" then set vdOut to vdOut & "ytmusic" & tab & (${title} of vdTab) & linefeed
      end repeat
    end repeat
  end tell
end try
`;
}
const AS_VOL = `try
  set vdVol to get volume settings
  set vdOut to vdOut & "vol" & tab & (output volume of vdVol as text) & tab & (output muted of vdVol as text) & tab & (input volume of vdVol as text) & linefeed
end try
`;
let macVol = { vol: null, mute: false, mic: null, micPrev: 75 };   // mic: input level (macOS has no mic mute: 0 = muted)
async function osa(script, timeout) {
  const r = await run('osascript', ['-'], timeout, 'set vdOut to ""\n' + script + 'return vdOut');
  return r;
}
async function macVolume() {
  // volume needs no permission: keep it in its own call so a pending "control Chrome?" prompt never blocks it
  const r = await osa(AS_VOL, 3000);
  const f = r.stdout.trim().split('\t');
  if (f[0] === 'vol') { const v = num(f[1]), m = num(f[3]); macVol = { ...macVol, vol: v >= 0 ? Math.round(v) : null, mute: f[2] === 'true', mic: m >= 0 ? Math.round(m) : null }; if (macVol.mic > 0) macVol.micPrev = macVol.mic; }
  return macVol;
}
// Each app is queried in the background and the newest answer is cached, so the 2 s poll never waits.
// The first query to an app shows macOS' "Volkan Deck wants to control …" prompt: give the user a minute to answer it.
const macApp = {};              // app -> { out, at, busy }
function macQuery(app, script) {
  const st = macApp[app] || (macApp[app] = { out: '', at: 0, busy: false });
  if (st.busy) return;
  st.busy = true;
  osa(script, 60000).then(r => { st.out = r.code ? '' : r.stdout; st.at = Date.now(); st.busy = false; });
}
async function macPoll(wantMedia, wantVol) {
  if (wantVol) await macVolume();
  const lines = [];
  if (wantMedia) {
    const running = await macRunning(), now = Date.now();
    const parts = [];
    if (running.has('Spotify')) parts.push(['Spotify', asPlayer('spotify', 'Spotify', 1000)]);
    if (running.has('Music')) parts.push(['Music', asPlayer('music', 'Music', 1)]);
    for (const [app, kind] of MAC_BROWSERS) if (running.has(app)) parts.push([app, asBrowser(app, kind)]);
    for (const [app, script] of parts) {
      macQuery(app, script);
      const st = macApp[app];
      if (st && now - st.at < 10000) lines.push(st.out);
    }
  }
  const cands = [];
  for (const line of lines.join('\n').split(/\r?\n/)) {
    const f = line.split('\t'); if (!f[0]) continue;
    if (f[0] === 'ytmusic') {
      const t = (f[1] || '').replace(/\s*[-–—|]\s*YouTube Music\s*$/i, '').trim();
      if (cands.some(c => c.player === 'ytmusic')) continue;
      cands.push({ player: 'ytmusic', name: 'YouTube Music', title: /^youtube music$/i.test(t) ? '' : t, artist: '', playing: false, pos: -1, dur: -1, ctl: 'keys' });
      continue;
    }
    if (!NAMES[f[0]]) continue;
    const state = (f[1] || '').toLowerCase();
    cands.push({ player: f[0], name: NAMES[f[0]], title: f[2] || '', artist: f[3] || '', playing: state === 'playing', pos: num(f[4]), dur: num(f[5]), ctl: 'app' });
  }
  return cands;
}

// Built-in display brightness (MacBook): private DisplayServices / CoreDisplay calls through JXA
const JXA_BRIGHT = v => `
ObjC.import('CoreGraphics');
$.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/DisplayServices.framework').load;
ObjC.bindFunction('DisplayServicesGetBrightness', ['int', ['unsigned int', 'float *']]);
ObjC.bindFunction('DisplayServicesSetBrightness', ['int', ['unsigned int', 'float']]);
var d = $.CGMainDisplayID();
${v == null ? '' : `$.DisplayServicesSetBrightness(d, ${Math.max(0, Math.min(100, v)) / 100});`}
var r = Ref('float'); var e = $.DisplayServicesGetBrightness(d, r);
e === 0 ? String(Math.round(r[0] * 100)) : 'err' + e;
`;
let macBright = { v: null, at: 0, broken: false };
async function macBrightness(set) {
  if (macBright.broken && set == null) return null;
  const r = await run('osascript', ['-l', 'JavaScript', '-'], 4000, JXA_BRIGHT(set));
  const v = parseInt(r.stdout.trim(), 10);
  if (isFinite(v) && v >= 0 && v <= 100) { macBright = { v, at: Date.now(), broken: false }; return v; }
  macBright.broken = true; macBright.at = Date.now(); return null;
}

/* ===================== public API ===================== */
let winSys = { vol: null, mute: false, mic: -1 }, winBright = { v: null, at: 0 };
async function hostState({ target = 'auto', media = true, sys = true } = {}) {
  const out = {};
  if (IS_WIN) {
    if (media) out.media = shape(pick((await winMedia(target)) || [], target));
    if (sys) {
      const v = await ps('vol', {}, 3000);
      if (v.ok && v.r) winSys = { vol: v.r.vol, mute: !!v.r.mute, mic: v.r.mic ?? -1 };
      if (Date.now() - winBright.at > 10000) {          // DDC/CI is slow: read the monitor every 10 s
        const b = await ps('bright', {}, 8000);
        winBright = { v: b.ok && b.r >= 0 ? b.r : null, at: Date.now() };
      }
      out.sys = { vol: winSys.vol, mute: winSys.mute, bright: winBright.v, micMute: winSys.mic < 0 ? null : winSys.mic === 1 };
    }
  } else if (IS_MAC) {
    const cands = await macPoll(media, sys);
    if (media) out.media = shape(pick(cands, target));
    if (sys) {
      if (!macBright.broken && Date.now() - macBright.at > 5000) await macBrightness();
      else if (macBright.broken && Date.now() - macBright.at > 60000) { macBright.broken = false; await macBrightness(); }
      out.sys = { vol: macVol.vol, mute: macVol.mute, bright: macBright.broken ? null : macBright.v, micMute: macVol.mic == null ? null : macVol.mic === 0 };
    }
  }
  return out;
}

async function mediaControl(action, target = 'auto') {
  if (!['play_pause', 'next', 'prev'].includes(action)) return { ok: false, error: 'bad action' };
  if (IS_WIN) {
    const c = pick((await winMedia(target)) || [], target);
    if (!c) return { ok: false, error: 'Çalan uygulama yok' };
    const r = await ps('mctl', { app: c.app, action });
    return r.ok && r.r ? { ok: true, player: c.player } : { ok: false, error: r.error || 'Uygulama komutu kabul etmedi' };
  }
  if (IS_MAC) {
    const c = pick(await macPoll(true, false), target);
    if (!c || c.ctl !== 'app') return { ok: false, error: 'keys' };
    const verb = { play_pause: 'playpause', next: 'next track', prev: 'previous track' }[action];
    const r = await run('osascript', ['-e', `tell application "${MAC_APPS[c.player]}" to ${verb}`], 4000);
    return r.code === 0 ? { ok: true, player: c.player } : { ok: false, error: r.stderr.trim() || 'osascript' };
  }
  return { ok: false, error: 'unsupported' };
}

async function sysSet(o = {}) {
  const res = {};
  if (IS_WIN) {
    if (o.vol != null) { const r = await ps('setvol', { v: Math.round(o.vol) }, 3000); res.vol = r.ok; if (r.ok) winSys.vol = Math.round(o.vol); }
    if (o.mute != null) { const r = await ps('setmute', { v: !!o.mute }, 3000); res.mute = r.ok; if (r.ok) winSys.mute = !!o.mute; }
    if (o.micMute != null) { const r = await ps('setmicmute', { v: !!o.micMute }, 3000); res.micMute = r.ok && r.r > 0; if (res.micMute) winSys.mic = o.micMute ? 1 : 0; }
    if (o.bright != null) { const r = await ps('setbright', { v: Math.round(o.bright) }, 8000); res.bright = r.ok && r.r > 0; if (res.bright) winBright = { v: Math.round(o.bright), at: Date.now() }; }
  } else if (IS_MAC) {
    const lines = [];
    if (o.vol != null) lines.push(`set volume output volume ${Math.max(0, Math.min(100, Math.round(o.vol)))}`);
    if (o.mute != null) lines.push(`set volume output muted ${o.mute ? 'true' : 'false'}`);
    const micTo = o.micMute == null ? null : o.micMute ? 0 : Math.max(5, macVol.micPrev || 75);
    if (micTo != null) lines.push(`set volume input volume ${micTo}`);
    if (lines.length) { const r = await run('osascript', lines.flatMap(l => ['-e', l]), 3000); res.vol = r.code === 0; if (res.vol) { if (o.vol != null) macVol.vol = Math.round(o.vol); if (o.mute != null) macVol.mute = !!o.mute; if (micTo != null) macVol.mic = micTo; } }
    if (o.bright != null) { const v = await macBrightness(o.bright); res.bright = v != null; }
  }
  return res;
}

function stop() { hostHelper.stop(); artHelper.stop(); }
module.exports = { hostState, mediaArt: art.get, mediaControl, sysSet, stop, devText };
