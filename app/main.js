// Volkan Deck — desktop companion (Windows + macOS)
// Keeps the USB link to the deck, opens apps directly when a key is pressed (no Win+R / Spotlight typing),
// forwards home-screen statistics and hosts the settings UI.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, nativeImage, session, Notification, nativeTheme, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const cp = require('child_process');
const media = require('./media');
const { timing } = require('./debug');
const { createStats } = require('./stats');
const { createSensorInstaller } = require('./sensor-install');
const { createUpdater, REPO_URL } = require('./updater');
const { createTrayUpdate, openLocationSettings } = require('./main-actions');
const { createMailWatcher } = require('./mail');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const ESP_VID = 0x303a;

// Use Chromium's OS provider, never its Google network provider (no API key).
// services/device/public/cpp/device_features.cc: LocationProviderManagerMode.
if (IS_MAC || IS_WIN) {
  const features = app.commandLine.getSwitchValue('enable-features');
  app.commandLine.appendSwitch('enable-features', [features, 'LocationProviderManager:LocationProviderManagerMode/PlatformOnly'].filter(Boolean).join(','));
}
app.setName('Volkan Deck');
const sensorInstaller = createSensorInstaller({ fetch: (...args) => net.fetch(...args), cacheDir: path.join(app.getPath('userData'), 'stats-cache') });
const stats = createStats({ fetch: (...args) => net.fetch(...args), cacheDir: path.join(app.getPath('userData'), 'stats-cache'), sensorFile: sensorInstaller.sensorFile });
if (IS_WIN) app.setAppUserModelId('com.volkan.deck');
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null, tray = null, quitting = false;
let status = { connected: false, text: 'Bağlı değil', direct: false };
let statsPausedForUpdate = false;
const statePath = () => path.join(app.getPath('userData'), 'state.json');
function readState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (e) { return {}; } }
function writeState(s, strict = false) { try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(s)); } catch (e) { if (strict) throw e; } }
const updater = createUpdater({ app, net, media, readState, writeState, onState: s => {
  if (s.phase === 'installing') { stats.stop(); statsPausedForUpdate = true; }
  else if (statsPausedForUpdate) { statsPausedForUpdate = false; stats.start(); }
  refreshTray();
  if (win && !win.isDestroyed()) win.webContents.send('update-state', s);
} });
const trayUpdate = createTrayUpdate({ updater, dialog, refreshTray });

const startHidden = process.argv.includes('--hidden') || (IS_MAC && app.getLoginItemSettings().wasOpenedAtLogin);

/* ---------------- window ---------------- */
function createWindow() {
  const updatedAtStart = !!updater.getState().receipt;
  win = new BrowserWindow({
    width: 1320, height: 900, minWidth: 980, minHeight: 640, show: false,
    title: 'Volkan Deck', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0E1116',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false }
  });
  win.removeMenu?.();
  setupBluetooth(win.webContents);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('page-title-updated', e => e.preventDefault());   // keep the status in the title bar / taskbar
  win.once('ready-to-show', () => {
    if (!startHidden || updatedAtStart) showWindow();
    else if (IS_MAC) setDock(false);                           // started at login: menu bar only
    applyStatusVisual();
  });
  if (process.env.DECK_SHOT || process.env.VOLKAN_DEBUG === '1') {
    win.webContents.on('console-message', (e, ...a) => { const d = a[0] && typeof a[0] === 'object' ? a[0] : { level: a[0], message: a[1], lineNumber: a[2] }; console.log('[page]', d.level, d.message, d.lineNumber); });
  }
  if (process.env.DECK_SHOT) {   // test hook: screenshot + console dump, then quit
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try { if (process.env.DECK_EVAL) console.log('[eval]', JSON.stringify(await win.webContents.executeJavaScript(process.env.DECK_EVAL, true))); } catch (e) { console.log('[eval-err]', e.message); }
      const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.DECK_SHOT, img.toPNG()); quitting = true; app.quit();
    }, 4000));
  }
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault(); hideWindow();
    const st = readState();
    if (!st.hiddenTipShown && Notification.isSupported()) {
      new Notification({ title: 'Volkan Deck arka planda çalışıyor', body: IS_MAC ? 'Menü çubuğundaki simgesinden açabilirsin; kapatmak için simge → Çık.' : 'Görev çubuğunun sağındaki simgesine tıklayarak açabilirsin (gizli simgeler ^ içinde olabilir). Kapatmak için simgeye sağ tıkla → Çık.' }).show();
      st.hiddenTipShown = true; writeState(st);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}
let inDock = true;
function setDock(on) {                      // macOS: 'regular' = Dock icon, 'accessory' = menu bar only
  if (!IS_MAC) return;
  inDock = on;
  if (on) { app.setActivationPolicy('regular'); app.dock?.show(); applyStatusVisual(); return; }
  // macOS keeps the Dock tile of the frontmost app: deactivate first (focus goes back to the previous app), then drop the tile
  app.hide();
  setTimeout(() => { if (!inDock) { app.setActivationPolicy('accessory'); app.dock?.hide(); } }, 150);
}
function showWindow() { setDock(true); if (IS_MAC) app.show(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); if (IS_MAC) app.focus({ steal: true }); }
// The X button never quits: the window hides and the app lives only as a status icon
// (macOS: menu bar, no Dock icon; Windows: notification area of the taskbar).
function hideWindow() { win.hide(); setDock(false); }

/* ---------------- running status, always visible (Dock icon / taskbar overlay / tray) ---------------- */
function statusKey() { return status.connected ? (status.direct ? 'on' : 'warn') : 'off'; }
const STATUS_TEXT = { on: 'Bağlı · uygulamaları açıyor', warn: 'Bağlı · firmware güncellemesi gerekli', off: 'Cihaz bağlı değil' };
function applyStatusVisual() {
  const k = statusKey();
  if (win && !win.isDestroyed()) {
    win.setTitle('Volkan Deck — ' + STATUS_TEXT[k]);
    if (IS_WIN) win.setOverlayIcon(nativeImage.createFromPath(path.join(__dirname, 'overlay-' + k + '.png')), STATUS_TEXT[k]);
  }
  if (IS_MAC && app.dock && inDock) app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'dock-' + k + '.png')));
  if (IS_MAC && tray) { const im = nativeImage.createFromPath(path.join(__dirname, 'trayT-' + k + 'Template.png')); im.setTemplateImage(true); tray.setImage(im); }
  if (IS_WIN && tray) tray.setImage(nativeImage.createFromPath(path.join(__dirname, 'tray-win-' + k + '.png')));
  if (tray) tray.setToolTip('Volkan Deck — ' + STATUS_TEXT[k]);
}

/* ---------------- tray ---------------- */
function buildTray() {
  const img = IS_MAC ? nativeImage.createFromPath(path.join(__dirname, 'trayT-offTemplate.png'))
                     : nativeImage.createFromPath(path.join(__dirname, 'tray-win-off.png'));
  if (IS_MAC) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.on('click', () => { if (!IS_MAC) { if (win.isVisible() && !win.isMinimized()) hideWindow(); else showWindow(); } });
  nativeTheme.on('updated', applyStatusVisual);
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setToolTip('Volkan Deck — ' + status.text);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status.connected ? '● ' + status.text : '○ Cihaz bağlı değil', enabled: false },
    { label: status.direct ? 'Uygulamalar doğrudan açılıyor' : 'Doğrudan açma kapalı (klavye yöntemi)', enabled: false },
    { type: 'separator' },
    { label: 'Ayarları aç', click: showWindow },
    { label: updater.getState().available ? 'Güncelleme var — yükle…' : 'Güncellemeleri kontrol et', click: trayUpdate },
    { label: 'Bilgisayar açılınca başlat', type: 'checkbox', checked: login, click: m => setLogin(m.checked) },
    { type: 'separator' },
    { label: 'Çık', click: () => { quitting = true; app.quit(); } }
  ]));
}
function setLogin(on) {
  app.setLoginItemSettings(IS_WIN ? { openAtLogin: on, args: ['--hidden'] } : { openAtLogin: on, openAsHidden: true });
  refreshTray();
}

/* ---------------- Web Bluetooth: the deck's data channel, picked without a chooser ---------------- */
// macOS kills an app that touches Bluetooth without a usage description in its Info.plist
function bluetoothReady() {
  if (!IS_MAC) return true;
  try { return fs.readFileSync(path.join(path.dirname(app.getPath('exe')), '..', 'Info.plist')).includes('NSBluetoothAlwaysUsageDescription'); }
  catch (e) { return false; }
}
function setupBluetooth(wc) {
  let pending = null, timer = null;
  const finish = id => { clearTimeout(timer); timer = null; const cb = pending; pending = null; if (cb) cb(id); };
  wc.on('select-bluetooth-device', (event, list, callback) => {
    event.preventDefault();
    pending = callback;
    if (list.length) return finish(list[0].deviceId);         // the page filters by the Volkan Deck service
    if (!timer) timer = setTimeout(() => finish(''), 8000);    // nothing nearby: give up, the page retries later
  });
  session.defaultSession.setBluetoothPairingHandler?.((details, callback) => callback({ confirmed: details.pairingKind === 'confirm' || details.pairingKind === 'confirmPin' }));
}
ipcMain.handle('ble-ready', () => bluetoothReady());
// Windows: connecting to a deck that is not paired in Windows makes Windows try to pair on its own and show
// "Try connecting your device again" each time; the app only uses Bluetooth once Windows lists the deck.
let blePairedCache = { name: '', at: 0, value: false };
async function blePaired(name) {
  if (!IS_WIN) return true;
  name = String(name || 'Volkan Deck').slice(0, 40);
  if (blePairedCache.name === name && Date.now() - blePairedCache.at < 60e3) return blePairedCache.value;
  const q = name.replace(/'/g, "''");
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'BTHLE\\DEV_*' -and $_.FriendlyName -eq '${q}' }).Count`], 15000);
  const n = parseInt(r.stdout.trim(), 10);
  const value = r.code !== 0 || isNaN(n) ? true : n > 0;    // if Windows can't be asked, don't block Bluetooth
  blePairedCache = { name, at: Date.now(), value };
  return value;
}
ipcMain.handle('ble-paired', (e, name) => blePaired(name));
// computer name shown on the deck's Bağlantılar page (sent over Bluetooth with the first companion message)
let hostName = null;
// seconds since the last keyboard / mouse input: the deck sends keys to the computer in use
ipcMain.handle('idle-time', () => { try { return require('electron').powerMonitor.getSystemIdleTime(); } catch (e) { return -1; } });
ipcMain.handle('host-name', async () => {
  if (hostName) return hostName;
  if (IS_MAC) { const r = await run('scutil', ['--get', 'ComputerName'], 3000); hostName = r.stdout.trim(); }
  if (!hostName) hostName = (process.env.COMPUTERNAME || require('os').hostname() || '').replace(/\.local$/, '');
  return hostName;
});

/* ---------------- Web Serial: auto-pick the deck, no chooser ---------------- */
function isEsp(p) {
  const v = p.vendorId; if (v == null) return false;
  const s = String(v);
  return parseInt(s, 10) === ESP_VID || parseInt(s, 16) === ESP_VID;
}
function setupSerial() {
  const ses = session.defaultSession;
  ses.on('select-serial-port', (event, portList, wc, callback) => {
    event.preventDefault();
    const p = portList.find(isEsp);
    callback(p ? p.portId : '');
  });
  const ownPage = (wc, url) => wc === win?.webContents && url === pathToFileURL(path.join(__dirname, 'index.html')).href;
  const allowed = ['serial', 'bluetooth', 'notifications', 'clipboard-sanitized-write', 'clipboard-read'];
  ses.setPermissionCheckHandler((wc, perm, origin, details) => perm === 'geolocation' ? ownPage(wc, details?.requestingUrl || wc?.getURL()) : allowed.includes(perm));
  ses.setPermissionRequestHandler((wc, perm, callback, details) => callback(perm === 'geolocation' ? ownPage(wc, details?.requestingUrl || wc?.getURL()) : allowed.includes(perm)));
  ses.setDevicePermissionHandler(d => d.deviceType === 'serial' || d.deviceType === 'bluetooth');
  // ask the page to (re)connect every few seconds; userGesture=true satisfies requestPort()
  setInterval(() => {
    if (win && !win.isDestroyed()) win.webContents.executeJavaScript('window.__deckAutoConnect && window.__deckAutoConnect()', true).catch(() => {});
  }, 3000);
}

/* ---------------- launching ---------------- */
const ok = how => ({ ok: true, how });
const fail = error => ({ ok: false, error });
const isUrl = s => /^[a-z][a-z0-9+.-]+:/i.test(s) && !/^[a-z]:[\\/]/i.test(s);

function detached(cmd, args, opts = {}) {
  return new Promise(res => {
    try {
      const ch = cp.spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
      ch.once('error', e => res(fail(e.message)));
      ch.once('spawn', () => { ch.unref(); res(ok(cmd)); });
    } catch (e) { res(fail(e.message)); }
  });
}
function run(cmd, args, timeout = 8000) {
  return new Promise(res => cp.execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout, stderr) =>
    res({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') })));
}

// Windows Start menu index (classic + Store apps) via Get-StartApps
let startApps = [], startAppsAt = 0;
async function refreshStartApps() {
  if (!IS_WIN) return;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'], 20000);
  try { const j = JSON.parse(r.stdout); startApps = Array.isArray(j) ? j : [j]; startAppsAt = Date.now(); } catch (e) {}
}
const norm = s => String(s || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
async function findStartApp(name) {
  if (!startApps.length || Date.now() - startAppsAt > 10 * 60e3) await refreshStartApps();
  const n = norm(name); if (!n) return null;
  return startApps.find(a => norm(a.Name) === n) || startApps.find(a => norm(a.Name).startsWith(n)) || startApps.find(a => norm(a.Name).includes(n)) || null;
}

// Windows: everything is a direct system call (CreateProcess / ShellExecute); no Run box, no Start search UI.
// bg = open minimized without taking focus (start /MIN → SW_SHOWMINNOACTIVE).
function winStart(target, { dir = null, bg = false, args = '' } = {}) {
  const q = s => '"' + String(s).replace(/"/g, '') + '"';
  const line = 'start "" ' + (bg ? '/MIN ' : '') + (dir ? '/D ' + q(dir) + ' ' : '') + q(target) + (args ? ' ' + args : '');
  return detached('cmd.exe', ['/d /s /c "' + line + '"'], { windowsVerbatimArguments: true });
}
async function launchWin(e) {
  const bg = !!e.bg;
  const p = String(e.path || '').trim();
  if (p) {
    if (isUrl(p)) { if (bg) return winStart(p, { bg }); await shell.openExternal(p, { activate: true }); return ok('adres'); }
    if (fs.existsSync(p)) {
      if (/\.exe$/i.test(p)) return bg ? winStart(p, { dir: path.dirname(p), bg }) : detached(p, [], { cwd: path.dirname(p) });
      // scripts run (not opened in an editor); the console window shows unless "Arka planda aç"
      if (/\.ps1$/i.test(p)) return detached('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...(bg ? ['-WindowStyle', 'Hidden'] : []), '-File', p], { cwd: path.dirname(p), windowsHide: bg });
      if (/\.(bat|cmd)$/i.test(p)) return winStart(p, { dir: path.dirname(p), bg });
      if (/\.vbs$/i.test(p)) return detached('wscript.exe', [p], { cwd: path.dirname(p) });
      if (bg) return winStart(p, { dir: path.dirname(p), bg });   // .lnk / .url / documents
      const err = await shell.openPath(p);
      return err ? fail(err) : ok('dosya');
    }
  }
  const v = String(e.value || '').trim();
  if (e.method === 'run' && v) {
    if (isUrl(v)) { if (bg) return winStart(v, { bg }); await shell.openExternal(v); return ok('adres'); }
    // a command like the Run box would take, but executed directly: "C:\x\app.exe" -args  /  chrome  /  calc
    const m = v.match(/^"([^"]+)"\s*(.*)$/) || v.match(/^(\S+)\s*(.*)$/);
    const exe = m ? m[1] : v, args = m ? m[2] : '';
    const dir = fs.existsSync(exe) ? path.dirname(exe) : null;
    if (dir && /\.exe$/i.test(exe) && !bg) return detached(exe, args ? args.match(/"[^"]*"|\S+/g).map(a => a.replace(/^"|"$/g, '')) : [], { cwd: dir });
    return winStart(exe, { dir, bg, args });          // also resolves App Paths names (chrome, code, …)
  }
  const name = e.method === 'search' ? (v || e.name) : e.name;
  const hit = await findStartApp(name);               // Start menu index (Get-StartApps), not the search UI
  if (hit) {
    if (bg) return winStart('shell:AppsFolder\\' + hit.AppID, { bg });
    return detached('explorer.exe', ['shell:AppsFolder\\' + hit.AppID]);
  }
  return fail('Başlat menüsünde “' + name + '” bulunamadı');
}

async function openMac(args) {
  const r = await run('/usr/bin/open', args);
  return r.code === 0 ? ok('open') : fail((r.stderr || 'açılamadı').trim().split('\n').pop());
}
async function mdfindApp(name) {
  const q = "kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == '*" + String(name).replace(/['*\\]/g, '') + "*'cd";
  const r = await run('/usr/bin/mdfind', [q]);
  const list = r.stdout.split('\n').filter(Boolean).sort((a, b) => a.length - b.length);
  return list.find(x => x.startsWith('/Applications/')) || list[0] || null;
}
async function launchMac(e) {
  const g = e.bg ? ['-g'] : [];                       // -g: open in the background, keep the current app in front
  const m = String(e.mac || '').trim();
  if (m) {
    if (isUrl(m)) return openMac([...g, m]);
    if (m.startsWith('/')) {
      if (!fs.existsSync(m)) return fail(m + ' bulunamadı');
      // scripts run in the background (no Terminal window); .command files open in Terminal like Finder does
      const dir = path.dirname(m);
      if (/\.(sh|bash)$/i.test(m)) return detached('/bin/bash', [m], { cwd: dir });
      if (/\.zsh$/i.test(m)) return detached('/bin/zsh', [m], { cwd: dir });
      if (/\.py$/i.test(m)) return detached('/usr/bin/python3', [m], { cwd: dir });
      if (/\.(scpt|applescript)$/i.test(m)) return detached('/usr/bin/osascript', [m], { cwd: dir });
      return openMac([...g, m]);
    }
    return openMac([...g, '-a', m]);
  }
  const v = String(e.value || '').trim();
  if (e.method === 'run' && isUrl(v)) return openMac([...g, v]);     // steam://, discord://, spotify:
  const name = e.method === 'search' ? (v || e.name) : e.name;
  const r = await openMac([...g, '-a', name]);
  if (r.ok) return r;
  const found = await mdfindApp(name);
  if (found) return openMac([...g, found]);
  return fail('“' + name + '” adlı uygulama bulunamadı');
}

async function launch(e) {
  try { return IS_MAC ? await launchMac(e) : IS_WIN ? await launchWin(e) : fail('Bu sistem desteklenmiyor'); }
  catch (err) { return fail(err.message); }
}

/* ---------------- app picker (native dialog, real paths + icons) ---------------- */
const WIN_SCRIPTS = ['bat', 'cmd', 'ps1', 'vbs'], MAC_SCRIPTS = ['command', 'sh', 'zsh', 'bash', 'py', 'scpt', 'applescript'];
const isScript = p => new RegExp('\\.(' + (IS_MAC ? MAC_SCRIPTS : WIN_SCRIPTS).join('|') + ')$', 'i').test(p);
async function pickApps(multi) {
  const r = await dialog.showOpenDialog(win, {
    title: 'Uygulama seç',
    defaultPath: IS_MAC ? '/Applications' : undefined,
    properties: ['openFile', ...(multi ? ['multiSelections'] : [])],
    filters: IS_MAC ? [{ name: 'Uygulamalar ve komut dosyaları', extensions: ['app', ...MAC_SCRIPTS] }] : [{ name: 'Programlar, kısayollar ve komut dosyaları', extensions: ['exe', 'lnk', 'url', ...WIN_SCRIPTS] }]
  });
  if (r.canceled) return [];
  const out = [];
  for (const p of r.filePaths) out.push(await appInfo(p));
  return out;
}
// macOS: app.getFileIcon crashes on macOS 27 (thread-pool CHECK), so read the bundle's .icns with sips
async function macAppIcon(appPath) {
  try {
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    let name = '';
    for (const key of ['CFBundleIconFile', 'CFBundleIconName']) {
      const r = await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
      if (r.code === 0 && r.stdout.trim()) { name = r.stdout.trim(); break; }
    }
    const res = path.join(appPath, 'Contents', 'Resources');
    let icns = name ? path.join(res, /\.icns$/i.test(name) ? name : name + '.icns') : '';
    if (!icns || !fs.existsSync(icns)) {
      const any = fs.existsSync(res) ? fs.readdirSync(res).find(f => /\.icns$/i.test(f) && /app|icon/i.test(f)) : null;
      if (!any) return null; icns = path.join(res, any);
    }
    const out = path.join(app.getPath('temp'), 'vd-icon-' + process.pid + '-' + Date.now() + '.png');
    await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '128', icns, '--out', out]);
    if (!fs.existsSync(out)) return null;
    const data = 'data:image/png;base64,' + fs.readFileSync(out).toString('base64');
    fs.unlink(out, () => {});
    return data;
  } catch (e) { return null; }
}
async function appInfo(p) {
  let icon = null;
  const script = isScript(p);
  if (IS_MAC) icon = script ? null : await macAppIcon(p);
  else if (!script) { try { icon = (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch (e) {} }   // a script's icon is the editor's: use the line icon
  const name = path.basename(p).replace(/\.(app|exe|lnk|url|bat|cmd|ps1|vbs|command|sh|zsh|bash|py|scpt|applescript)$/i, '');
  let src = null;
  if (IS_WIN) {
    try {
      if (/\.lnk$/i.test(p)) { const l = shell.readShortcutLink(p); src = { file: path.basename(p), target: l.target, args: l.args || '', workdir: l.cwd || '', searchName: name }; }
      else if (/\.url$/i.test(p)) { const text = fs.readFileSync(p, 'utf8'); const url = text.match(/^URL=(.+)$/mi)?.[1]?.trim(); if (url) src = { file: path.basename(p), url, searchName: name }; }
    } catch (_) {}
  }
  return { path: p, name, icon, src, script };
}

/* ---------------- Outlook: new-mail note on the deck (firmware 1.8.0) ---------------- */
const mailWatcher = createMailWatcher({
  platform: process.platform, run, helper: IS_WIN ? media.helperClient('win-mail.ps1') : null,
  onMail: m => { if (win && !win.isDestroyed()) win.webContents.send('mail', m); },
  onState: s => { if (win && !win.isDestroyed()) win.webContents.send('mail-state', s); }
});
function mailSettings(patch) {
  const st = readState();
  if (patch && typeof patch === 'object') { st.mail = { ...mailWatcher.settings(), ...patch }; writeState(st); }
  return { settings: mailWatcher.configure(st.mail), state: mailWatcher.state() };
}
// Classic Outlook first (the notes come from it on Windows): /recycle brings back its open window.
async function openOutlook() {
  if (IS_MAC) return openMac(['-a', 'Microsoft Outlook']);
  if (!IS_WIN) return fail('Bu sistem desteklenmiyor');
  for (const hive of ['HKLM', 'HKCU']) {
    const r = await run('reg.exe', ['query', hive + '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\OUTLOOK.EXE', '/ve'], 4000);
    if (r.code === 0) return winStart('outlook.exe', { args: '/recycle' });
  }
  const hit = await findStartApp('Outlook');          // new Outlook only
  return hit ? detached('explorer.exe', ['shell:AppsFolder\\' + hit.AppID]) : fail('Outlook bulunamadı');
}

async function launchMediaPlayer(player) {
  if (player === 'ytmusic') { await shell.openExternal('https://music.youtube.com'); return ok('adres'); }
  if (IS_MAC) return openMac(['-a', player === 'spotify' ? 'Spotify' : 'Music']);
  if (IS_WIN && player === 'spotify') {
    const hit = await findStartApp('Spotify');
    if (hit) return detached('explorer.exe', ['shell:AppsFolder\\' + hit.AppID]);
    await shell.openExternal('spotify:'); return ok('adres');
  }
  if (IS_WIN && player === 'music') {
    const hit = await findStartApp('Apple Music');
    return hit ? detached('explorer.exe', ['shell:AppsFolder\\' + hit.AppID]) : fail('Apple Music kurulu değil');
  }
  return fail('Oynatıcı açılamadı');
}

/* ---------------- IPC ---------------- */
ipcMain.handle('launch', (ev, e) => launch(e));
ipcMain.handle('pick-apps', (ev, multi) => pickApps(!!multi));
ipcMain.handle('app-info', (ev, p) => appInfo(String(p || '')));
ipcMain.handle('stats-get', (ev, o) => stats.get(o));
// Old macOS bundles lack CoreLocation usage strings: do not ask there, use IP quietly.
ipcMain.handle('open-location-settings', () => openLocationSettings(process.platform, shell));
ipcMain.handle('location-available', () => {
  if (!IS_MAC) return true;
  try {
    const plist = fs.readFileSync(path.join(path.dirname(process.execPath), '..', 'Info.plist'), 'utf8');
    return /NSLocation(?:WhenInUse)?UsageDescription/.test(plist);
  } catch (_) { return false; }
});
ipcMain.handle('sensor-status', () => sensorInstaller.status());
ipcMain.handle('sensor-install', () => sensorInstaller.install());
ipcMain.handle('sensor-uninstall', () => sensorInstaller.uninstall());
ipcMain.handle('notify', (ev, t, b) => { if (Notification.isSupported()) new Notification({ title: t, body: b }).show(); });
ipcMain.on('status', (ev, s) => { const changed = JSON.stringify(s) !== JSON.stringify(status); status = s; mailWatcher.setLinked(!!(s.connected && s.direct && s.mail)); if (changed) { refreshTray(); applyStatusVisual(); } });
ipcMain.handle('mail-settings', (ev, patch) => mailSettings(patch));
ipcMain.handle('mail-open', async () => { try { return await openOutlook(); } catch (e) { return fail(e.message); } });
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('update-state', () => updater.getState());
ipcMain.handle('update-check', () => updater.check({ manual: true }));
ipcMain.handle('update-apply', () => updater.apply());
ipcMain.handle('update-channel', (ev, on) => updater.setChannel(!!on));
ipcMain.handle('update-ack', () => updater.acknowledge());
ipcMain.handle('update-repo', () => shell.openExternal(REPO_URL));
const mediaPaused = () => updater.getState().phase === 'installing';
ipcMain.handle('host-state', async (ev, o) => {
  const t0 = performance.now();
  try { return mediaPaused() ? {} : await media.hostState(o || {}).catch(e => ({ error: e.message })); }
  finally { timing('host-state', t0, o?.media === false ? 'ses/parlaklık' : 'medya'); }
});
ipcMain.handle('media-art', (ev, key, waitMs) => mediaPaused() ? null : media.mediaArtWait(String(key || ''), Math.max(0, Math.min(5000, Number(waitMs) || 0))));
ipcMain.handle('media-ctl', (ev, action, target, options) => mediaPaused() ? { ok: false, error: 'Güncelleme kuruluyor.' } : media.mediaControl(String(action || ''), String(target || 'auto'), { launch: options?.launch, launchPlayer: launchMediaPlayer }).catch(e => ({ ok: false, error: e.message })));
ipcMain.handle('sys-set', (ev, o) => mediaPaused() ? {} : media.sysSet(o || {}).catch(e => ({ error: e.message })));
app.on('will-quit', () => { updater.stop(); media.stop(); stats.stop(); mailWatcher.stop(); });

/* ---------------- lifecycle ---------------- */
app.on('second-instance', () => { if (win) showWindow(); });
app.on('activate', () => { if (win) showWindow(); });
app.on('before-quit', () => { quitting = true; });
app.whenReady().then(() => {
  sensorInstaller.init().catch(() => {});
  mailSettings();
  stats.start();
  updater.start();
  setupSerial();
  createWindow();
  buildTray(); applyStatusVisual();
  const st = readState();
  if (!st.loginAsked) { setLogin(true); st.loginAsked = true; writeState(st); }   // start with the computer by default
  refreshStartApps();
});
app.on('window-all-closed', e => { /* stay in the tray */ });
