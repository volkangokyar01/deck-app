// In-game FPS (firmware 1.16.0, Windows): PresentMon task → fps.json → foreground game → {"fps"} stats group
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const { pickFps, RATES } = require('../../app/stats.js');
const { ASSETS } = require('../../app/stats-assets.js');

test('pickFps shows the foreground game only, and nothing when the data is stale', () => {
  const now = 1_800_000_000_000, data = { epoch: now / 1000, procs: [
    { pid: 10, name: 'cs2.exe', fps: 287.4, low: 201.2 }, { pid: 11, name: 'chrome.exe', fps: 60, low: 58 }, { pid: 12, name: 'Game Deck.exe', fps: 60, low: 60 }] };
  assert.deepEqual(pickFps(data, 10, now), { fps: 287.4, low: 201.2, app: 'cs2' });
  assert.deepEqual(pickFps(data, 12, now), { fps: null, low: null, app: null }, 'our own window is not a game');
  assert.deepEqual(pickFps(data, 99, now), { fps: null, low: null, app: null }, 'foreground process is not presenting');
  assert.deepEqual(pickFps({ ...data, epoch: now / 1000 - 10 }, 10, now).fps, null, 'PresentMon task stopped');
  assert.deepEqual(pickFps(null, 10, now).fps, null);
  assert.equal(RATES.fps, 1000);
});

test('PresentMon is pinned in the app and checked again (hash + Intel signature) by the elevated setup', () => {
  const setup = read('app/sensor-setup.ps1');
  assert.match(setup, new RegExp("\\$pmHash = '" + ASSETS.presentmon.sha256 + "'"));
  assert.match(setup, /\$sig\.SignerCertificate\.Subject -notmatch 'O=Intel Corporation'/);
  assert.match(setup, /Register-ScheduledTask -TaskName \$fpsTask/);
  assert.match(read('app/sensor-install.js'), /PresentMon: presentmon, FpsHelper: path\.join\(__dirname, 'win-fps\.ps1'\)/);
  const un = read('app/sensor-uninstall.ps1');
  assert.match(un, /\$fpsTask = 'VolkanDeckFPS-' \+ \$UserSid/);
  assert.match(un, /logman\.exe'\) stop GameDeckFPS -ets/);
  const fps = read('app/win-fps.ps1');
  assert.match(fps, /--no_track_gpu --no_track_input --no_track_display/);
  assert.match(fps, /'MsBetweenPresents' \{ \$iMs = \$i \}/);
  assert.match(read('app/win-stats.ps1'), /@\{ nics = \$counters; fg = \$fg \}/);
});

test('firmware and settings page know the fps card; it shows ping too', () => {
  const store = read('firmware/VolkanDeck/Store.h'), ui = read('firmware/VolkanDeck/Ui.h'), stats = read('firmware/VolkanDeck/Stats.h'), web = read('web/body.html');
  assert.match(store, /WIDGET_IDS\[7\] = \{ "cpu", "gpu", "clock", "weather", "fx", "net", "fps" \}/);
  assert.match(stats, /if \(d\["fps"\]\.is<JsonObjectConst>\(\)\)/);
  const card = ui.slice(ui.indexOf('static void drawFpsCard('), ui.indexOf('static void drawCard('));
  assert.match(card, /pingText\(x, y \+ 9, w\);/);
  assert.match(ui, /case W_FPS: drawFpsCard\(x, y, w, h\); break;/);
  assert.match(web, /\["fps","FPS"\]\];/);
  assert.match(web, /else if \(id==="fps"\) drawFpsCard\(x,y,w,h\);/);
});

test('sensor setup keeps an existing PawnIO (exit 183 "already exists" no longer fails the refresh / FPS step)', () => {
  const setup = read('app/sensor-setup.ps1');
  assert.match(setup, /if \(-not \$pawnioPresent\) \{\n    \$p = Start-Process -FilePath \$signedSetup/);
  assert.match(setup, /\$p\.ExitCode -notin @\(0, 3010, 183\)/);
});

test('FPS does not blink: half-written file keeps the last one, the last value is held 3 s, fps from frame times', () => {
  const stats = read('app/stats.js'), fpsPs = read('app/win-fps.ps1');
  assert.match(stats, /else cache\.fps = fpsGood && Date\.now\(\) - fpsGoodAt < 3000 \? fpsGood : pick;/);
  assert.match(stats, /if \(f\) fpsData = JSON\.parse/);
  assert.match(fpsPs, /for \(\$i = \$f\.Length - 1; \$i -ge 0 -and \$sum -lt 1000; \$i--\)/);
  assert.match(read('app/sensor-install.js'), /fpsOld = h\(path\.join\(dir, 'win-fps\.ps1'\)\) !== h\(path\.join\(__dirname, 'win-fps\.ps1'\)\)/);
});
