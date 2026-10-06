// New Outlook mail → a note on the deck's screen (firmware 1.8.0). No Electron import: main.js supplies run / helper.
//   macOS:   the unread count on Outlook's Dock icon, read with lsappinfo. No permission; works for classic and new
//            Outlook. The subject is not available: new Outlook has no AppleScript.
//   Windows: classic Outlook over COM in its own PowerShell helper (win-mail.ps1): the unread count of every inbox,
//            the newest subject only when the count goes up. New Outlook (olk.exe) offers no local interface.
const { devText } = require('./media');

const SECONDS = [5, 10, 15, 30, 60];
const DEFAULTS = { enabled: true, seconds: 10, subject: true };
const MAC_APP = 'Microsoft Outlook';

function normalizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  return { enabled: o.enabled !== false, seconds: SECONDS.includes(Number(o.seconds)) ? Number(o.seconds) : DEFAULTS.seconds, subject: o.subject !== false };
}

// lsappinfo: "StatusLabel"={ "label"="3" } · no badge: "StatusLabel"=[ NULL ] · "99+" → 99 · a non-numeric badge → 1
function parseBadge(out) {
  const m = String(out || '').match(/"label"\s*=\s*"([^"]*)"/);
  if (!m || !m[1].trim()) return 0;
  const n = parseInt(m[1].replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 1;
}

// New mail = the unread count went up. The first sample is only a baseline; after Outlook starts, its sync raises
// the count for a while, so increases are ignored during warm-up.
function createTracker({ now = Date.now, warmupMs = 20000 } = {}) {
  let seen = false, running = false, since = 0, last = null;
  return function update(sample) {
    if (!sample.running) { seen = true; running = false; last = null; return 0; }
    if (!running) { since = seen ? now() : now() - warmupMs; running = true; seen = true; }
    if (!Number.isFinite(sample.unread)) return 0;
    const prev = last; last = sample.unread;
    if (prev == null || now() - since < warmupMs) return 0;
    return Math.max(0, sample.unread - prev);
  };
}

function createMailWatcher({ platform, run, helper, onMail, onState, now = Date.now, intervalMs = 3000, warmupMs = 20000,
                             timers = { setTimeout, clearTimeout } }) {
  const supported = platform === 'darwin' || platform === 'win32';
  let settings = normalizeSettings(), linked = false, timer = null, active = false, generation = 0;
  let track = createTracker({ now, warmupMs });
  let state = { supported, active: false, running: false, unread: null, newOutlook: false, error: '' };
  function setState(patch) {
    const next = { ...state, ...patch };
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next; onState?.(state);
  }

  async function sampleMac() {
    const [pid, badge] = await Promise.all([
      run('/usr/bin/lsappinfo', ['info', '-only', 'pid', MAC_APP], 3000),
      run('/usr/bin/lsappinfo', ['info', '-only', 'StatusLabel', MAC_APP], 3000)]);
    if (pid.code !== 0) return { error: (pid.stderr || 'lsappinfo').trim() };
    const running = /"pid"\s*=\s*\d+/.test(pid.stdout);
    return { running, unread: running && badge.code === 0 ? parseBadge(badge.stdout) : null, error: '' };
  }
  async function sampleWin(top) {
    const r = await helper.call('mail', { top }, 8000);
    if (!r.ok || !r.r) return { error: r.error || 'Outlook yardımcısı yanıt vermedi' };
    const unread = Number(r.r.unread);
    return { running: !!r.r.running, unread: r.r.unread != null && Number.isFinite(unread) ? unread : null,
             newOutlook: !!r.r.newOutlook, subject: String(r.r.subject || ''), error: String(r.r.error || '') };
  }
  async function tick(gen) {
    const s = platform === 'darwin' ? await sampleMac() : await sampleWin(false);
    if (gen !== generation) return;
    if (s.running == null) { setState({ error: s.error }); return; }   // helper trouble: keep the baseline
    const fresh = track(s);
    setState({ running: s.running, unread: s.unread, newOutlook: !!s.newOutlook, error: s.error });
    if (!fresh) return;
    let subject = '';
    if (platform === 'win32' && settings.subject) {
      const t = await sampleWin(true);
      if (gen !== generation) return;
      subject = t.subject || '';
    }
    onMail?.({ subject: devText(subject, 90), unread: s.unread, fresh, ms: settings.seconds * 1000 });
  }
  async function loop(gen) {
    timer = null;
    try { await tick(gen); } catch (e) { if (gen === generation) setState({ error: e.message }); }
    if (gen === generation && active) timer = timers.setTimeout(() => loop(gen), intervalMs);
  }
  // Polls only while the feature is on and a deck that shows notes is connected.
  function apply() {
    const want = supported && settings.enabled && linked;
    if (want === active) return;
    active = want; generation++;
    if (timer) { timers.clearTimeout(timer); timer = null; }
    track = createTracker({ now, warmupMs });          // mail that came while paused is not shown later
    if (active) loop(generation);
    else if (!settings.enabled) helper?.stop();        // turned off: free the Outlook helper; a short unplug keeps it
    setState({ active, ...(active ? {} : { running: false, unread: null, error: '' }) });
  }
  return {
    configure(s) { settings = normalizeSettings(s); apply(); return settings; },
    setLinked(on) { linked = !!on; apply(); },
    settings: () => settings,
    state: () => state,
    stop() { linked = false; apply(); helper?.stop(); }
  };
}

module.exports = { createMailWatcher, createTracker, normalizeSettings, parseBadge, SECONDS, MAC_APP };
