// GitHub app-folder updates; Electron itself is still installed by the installers.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { createMacSigner } = require('./mac-sign');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'volkangokyar01/deck-app', REPO_URL = 'https://github.com/' + REPO;
const API = 'https://api.github.com/repos/' + REPO, CACHE_MS = 10 * 60e3, MANUAL_CACHE_MS = 30e3;
const REQUIRED = ['main.js', 'package.json', 'index.html', 'preload.js'];
const blobHash = content => crypto.createHash('sha1').update('blob ' + content.length + '\0').update(content).digest('hex');
const execFile = (cmd, args) => new Promise((resolve, reject) => cp.execFile(cmd, args,
  { timeout: 120e3, windowsHide: true, maxBuffer: 16 << 20 }, (err, out, stderr) => {
    if (err) { err.detail = (stderr || err.message).trim(); err.command = cmd; reject(err); }
    // -dr writes the designated requirement to stderr on macOS.
    else resolve(cmd === '/usr/bin/codesign' && args.includes('-dr') ? out + '\n' + stderr : out);
  }));
function userError(message, cause) {
  const e = new Error(message); e.userMessage = message;
  if (cause) e.detail = cause.detail || cause.message;
  return e;
}
function errorState(e) {
  const codes = { EPERM: 'Dosyalara erişilemiyor. Uygulamayı kapatıp tekrar dene.', EACCES: 'Dosyalara erişim izni yok.',
    EBUSY: 'Uygulama dosyaları kullanımda. Biraz sonra tekrar dene.', ENOSPC: 'Diskte yeterli boş alan yok.',
    ENOENT: 'Gerekli dosya bulunamadı. Kurulum betiğini yeniden çalıştır.' };
  const network = /^(ECONN|ENET|EHOST|EAI_|ENOTFOUND|UND_ERR_)/.test(e.code || e.cause?.code || '');
  const message = e.userMessage || codes[e.code] || (e.code === 'ETIMEDOUT' || e.name === 'AbortError' ?
    'Bağlantı zaman aşımına uğradı. Tekrar dene.' : network || e instanceof TypeError ?
    'İnternet bağlantısı kurulamadı. Bağlantını kontrol et.' : /(?:^|[\\/])tar(?:\.exe)?$/i.test(e.command || '') ?
    'Güncelleme arşivi açılamadı. Tekrar indirip dene.' : 'Güncelleme işlemi tamamlanamadı. Tekrar dene.');
  return { phase: 'error', message, detail: e.detail || e.message };
}
function isInstalledApp(dir, platform = process.platform, exists = fs.existsSync) {
  const p = platform === 'win32' ? path.win32 : path;
  dir = p.resolve(dir);
  if (p.basename(dir) !== 'app' || dir.split(/[\\/]/).some(s => s.toLowerCase() === 'node_modules')) return false;
  if (platform === 'darwin') {
    try { if (p.basename(bundleFor(dir)).toLowerCase() === 'electron.app') return false; }
    catch (e) { return false; }
  } else if (platform === 'win32') {
    if (p.basename(p.dirname(dir)).toLowerCase() !== 'resources' ||
        !exists(p.join(p.dirname(p.dirname(dir)), 'Volkan Deck.exe'))) return false;
  } else return false;
  const locations = [dir];
  try { locations.push(fs.realpathSync(dir)); } catch (e) {}
  // Include physical ancestors too, catching symlinks into repos and .git worktree files.
  for (const location of locations) {
    if (location.split(/[\\/]/).some(s => s.toLowerCase() === 'node_modules')) return false;
    for (let ancestor = location; ; ancestor = p.dirname(ancestor)) {
      if (exists(p.join(ancestor, '.git'))) return false;
      if (p.dirname(ancestor) === ancestor) break;
    }
  }
  return true;
}

function appFiles(tree) {
  if (tree.truncated || !Array.isArray(tree.tree)) throw userError('GitHub dosya listesi eksik; güncelleme doğrulanamadı.');
  const files = tree.tree.filter(x => x.path.startsWith('app/') && x.type !== 'tree').map(x => {
    const name = x.path.slice(4);
    if (x.type !== 'blob' || !['100644', '100755'].includes(x.mode) || !/^[a-f0-9]{40}$/.test(x.sha) ||
        !name || name.split('/').some(p => !p || p === '.' || p === '..') || /[\\:\0]/.test(name))
      throw userError('Güncellemede desteklenmeyen dosya yolu veya türü var.');
    return { name, sha: x.sha };
  });
  if (!REQUIRED.every(name => files.some(x => x.name === name))) throw userError('GitHub uygulama dosyaları eksik.');
  return files;
}
async function differences(dir, files, platform) {
  const changed = [];
  for (const file of files) {
    if (file.name === 'build-info.json') continue;
    if (platform === 'darwin' && file.name === 'icon.ico') continue;
    try {
      const p = path.join(dir, file.name);
      if (!(await fsp.lstat(p)).isFile() || blobHash(await fsp.readFile(p)) !== file.sha) changed.push(file.name);
    } catch (e) { if (e.code === 'ENOENT') changed.push(file.name); else throw e; }
  }
  return changed;
}
async function verifyApp(dir, files) {
  for (const name of REQUIRED) if (!(await fsp.lstat(path.join(dir, name))).isFile()) throw userError('Uygulama dosyası eksik: ' + name);
  // Refuse links even in parent directories, before hashing or copying the archive.
  async function walk(p) {
    for (const entry of await fsp.readdir(p, { withFileTypes: true })) {
      const child = path.join(p, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (!entry.isFile()) throw userError('Arşivde desteklenmeyen dosya türü var.');
    }
  }
  await walk(dir);
  const changed = await differences(dir, files);
  if (changed.length) throw userError('İndirilen uygulama doğrulanamadı: ' + changed[0]);
}
async function extractApp(archive, dest, files, run = execFile, platform = process.platform) {
  await fsp.mkdir(dest, { recursive: true });
  const tar = platform === 'win32' ? path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const tarRun = async args => { try { return await run(tar, args); } catch (e) { e.command = tar; throw e; } };
  const names = (await tarRun(['-tzf', archive])).split(/\r?\n/).filter(Boolean);
  const root = names[0]?.split('/')[0];
  if (!root || names.some(n => n.split('/')[0] !== root || /[\\:\0]/.test(n) || n.split('/').some(p => p === '..' || p === '.')))
    throw userError('İndirilen arşivin yolları geçersiz.');
  // Only extract app/: unrelated firmware, installers and working files are never installed.
  await tarRun(['-xzf', archive, '-C', dest, root + '/app']);
  const dir = path.join(dest, root, 'app');
  await verifyApp(dir, files);
  return dir;
}
function bundleFor(dir) {
  const bundle = path.resolve(dir, '../../..');
  if (!bundle.endsWith('.app') || path.relative(bundle, dir) !== path.join('Contents', 'Resources', 'app'))
    throw userError('Uygulama paketi bulunamadı; kurulum betiğini yeniden çalıştır.');
  return bundle;
}
async function swapApp(current, incoming, { stop = () => {}, afterSwap = async () => {},
    prepareRestore = async () => {}, afterRestore = async () => {}, rename = fsp.rename.bind(fsp), platform = process.platform } = {}) {
  const old = current + '.old';
  await fsp.rm(old, { recursive: true, force: true });
  await stop();
  for (let attempt = 0; ; attempt++) {
    try { await rename(current, old); break; }
    catch (e) {
      if (platform !== 'win32' || !['EPERM', 'EBUSY'].includes(e.code) || attempt >= 10) throw e;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  try {
    await rename(incoming, current);
    await afterSwap(old);
  } catch (e) {
    const failed = current + '.failed';
    let moved = false;
    try {
      // Never move the complete new app until a complete rollback source is ready.
      await prepareRestore(old);
      if (!(await fsp.lstat(old)).isDirectory()) throw new Error('Rollback source is not a directory: ' + old);
      try { await rename(current, failed); moved = true; } catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
      try { await rename(old, current); }
      catch (restore) {
        if (moved) { await rename(failed, current); moved = false; await afterRestore(); }
        throw restore;
      }
      try { if (moved) await fsp.rm(failed, { recursive: true, force: true }); }
      finally { await afterRestore(); }
    } catch (restore) {
      const problem = userError(restore.userMessage || 'Geri yükleme tamamlanamadı; korunan uygulama kopyalarıyla kurulum betiğini yeniden çalıştır.',
        { message: (e.detail || e.message) + '\n' + (restore.detail || restore.message) + '\nKopyalar: ' + [current, old, failed].join(', ') });
      throw problem;
    }
    throw e;
  }
  // Cleanup failures are retried on next start; they must not undo a completed update.
  await fsp.rm(old, { recursive: true, force: true }).catch(() => {});
}

function createUpdater({ app, net, media, readState, writeState, onState = () => {}, platform = process.platform,
    electronVersion = process.versions.electron, run = execFile }) {
  const cache = new Map(), pending = new Map();
  const packaged = isInstalledApp(app.getAppPath(), platform);
  let target = null, applying = false, quitRequested = false, timers = [], cleanup = Promise.resolve();
  let releasesOnly = !!readState().updatesReleasesOnly;
  let state = { phase: 'idle', available: false, localNewer: false, needsInstaller: false, latest: null, message: 'Henüz kontrol edilmedi.', detail: null };
  let macSigner;
  const signer = () => macSigner ||= createMacSigner({ userData: app.getPath('userData'), run });
  const receiptPath = () => path.join(app.getPath('userData'), 'update-receipt.json');
  let receipt = null;
  const getState = () => ({ ...state, releasesOnly, packaged, receipt });
  const publish = s => { state = { ...state, ...s }; onState(getState()); return getState(); };
  async function request(url, consume, allowMissing = false) {
    const controller = new AbortController();
    let timeoutKind = 'headers', idle = null;
    const timeout = setTimeout(() => controller.abort(), 10e3);
    try {
      const r = await net.fetch(url, { headers: { 'User-Agent': 'Volkan-Deck-Updater', 'Accept': 'application/vnd.github+json' }, signal: controller.signal });
      clearTimeout(timeout);
      if (r.status === 404 && allowMissing) return null;
      if (r.status === 403 || r.status === 429) {
        const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
        throw userError('GitHub istek sınırına ulaşıldı veya erişim kısıtlandı. ' + (reset > Date.now() ? new Date(reset).toLocaleTimeString('tr-TR') + ' sonrasında' : 'Bir süre sonra') + ' tekrar dene.');
      }
      if (!r.ok) throw userError('GitHub bağlantısı başarısız (HTTP ' + r.status + ').');
      if (!r.body) return await consume(r);
      // Reset only on received bytes: a long download is fine while it keeps moving.
      const reader = r.body.getReader();
      const body = new ReadableStream({
        start(sink) {
          this.arm = () => {
            clearTimeout(idle);
            idle = setTimeout(() => {
              timeoutKind = 'body'; controller.abort();
              sink.error(userError('İndirme 20 saniye boyunca ilerlemedi. Tekrar dene.'));
              reader.cancel().catch(() => {});
            }, 20e3);
          };
          this.arm();
        },
        async pull(sink) {
          try {
            const { done, value } = await reader.read();
            if (done) { clearTimeout(idle); sink.close(); }
            else { if (value.byteLength) this.arm(); sink.enqueue(value); }
          } catch (e) { clearTimeout(idle); sink.error(e); }
        },
        cancel(reason) { clearTimeout(idle); return reader.cancel(reason); }
      });
      return await consume(new Response(body, { status: r.status, headers: r.headers }));
    } catch (e) {
      if (controller.signal.aborted) throw userError(timeoutKind === 'body' ?
        'İndirme 20 saniye boyunca ilerlemedi. Tekrar dene.' : 'GitHub bağlantısı 10 saniyede yanıt vermedi. Tekrar dene.', e);
      if (e instanceof TypeError) throw userError('GitHub’a bağlanılamadı. İnternet bağlantısını kontrol et.', e);
      throw e;
    } finally { clearTimeout(timeout); clearTimeout(idle); controller.abort(); }
  }
  const json = (url, allowMissing) => request(url, r => r.json(), allowMissing);
  async function detect(channel) {
    let release = null;
    if (channel) {
      release = await json(API + '/releases/latest', true);
      if (!release) return { result: { phase: 'no-release', available: false, localNewer: false, needsInstaller: false, latest: null, message: 'Henüz yayınlanmış sürüm yok', detail: null }, target: null };
    }
    const commit = await json(API + '/commits/' + (release ? encodeURIComponent(release.tag_name) : 'main'));
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw userError('GitHub commit bilgisi geçersiz.');
    const latest = { sha: commit.sha, message: release ? (release.name || release.tag_name) : commit.commit.message.split('\n')[0],
      author: commit.commit.author.name, date: commit.commit.author.date };
    const files = appFiles(await json(API + '/git/trees/' + latest.sha + '?recursive=1'));
    const changed = await differences(app.getAppPath(), files, platform);
    let diverged = false;
    if (changed.length) {
      let local = null;
      try { local = JSON.parse(await fsp.readFile(path.join(app.getAppPath(), 'build-info.json'), 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (local?.commit != null) {
        if (!/^[a-f0-9]{40}$/.test(local.commit)) throw userError('Yerel build commit bilgisi geçersiz.');
        // GitHub describes the head (local) relative to the base (target).
        const comparison = await json(API + '/compare/' + latest.sha + '...' + local.commit, true);
        if (!comparison || comparison.status === 'ahead' || (comparison.status === 'identical' && local.dirty))
          return { result: { phase: 'current', available: false, localNewer: true, needsInstaller: false, latest,
            message: 'Bu bilgisayardaki sürüm GitHub\'dakinden yeni (henüz gönderilmemiş değişiklikler var).', detail: null }, target: null };
        if (!['behind', 'identical', 'diverged'].includes(comparison.status))
          throw userError('GitHub commit karşılaştırması geçersiz; güncelleme doğrulanamadı.');
        diverged = comparison.status === 'diverged';
      }
    }
    const installer = platform === 'darwin' ? 'Mac-Kur.command' : platform === 'win32' ? 'Windows-Kur.bat' : null;
    let needsInstaller = false;
    if (installer) {
      const script = await request('https://raw.githubusercontent.com/' + REPO + '/' + latest.sha + '/installer/' + installer, r => r.text());
      const version = script.match(platform === 'darwin' ? /^V=([^\s]+)\s*$/m : /^set "V=([^"\r\n]+)"\s*$/mi)?.[1];
      if (!version) throw userError('Kurulum betiğindeki Electron sürümü okunamadı.');
      needsInstaller = version !== electronVersion;
    }
    const available = changed.length > 0 || needsInstaller;
    let message = needsInstaller ? 'Bu güncelleme yeni bir Electron sürümü gerektiriyor. GitHub sayfasından kurulum paketini alıp kurulum betiğini yeniden çalıştır.' : available ? 'Güncelleme var' : 'Güncel';
    if (diverged) message = "Bu bilgisayardaki sürümde GitHub'da olmayan değişiklikler var; güncellersen kaybolur." + (needsInstaller ? ' ' + message : '');
    return { result: { phase: available ? 'available' : 'current', available, localNewer: false, needsInstaller, latest, message, detail: null }, target: { latest, files } };
  }
  // Automatic checks reuse a result for 10 min; the "check" button only for 30 s, so a push made a minute ago shows up
  // (GitHub allows 60 unauthenticated API calls per hour, a check uses 3-4).
  async function check({ manual = false } = {}) {
    if (applying) return getState();
    const channel = releasesOnly, cached = cache.get(channel);
    if (cached && Date.now() - cached.at < (manual ? MANUAL_CACHE_MS : CACHE_MS)) { target = cached.target; return publish(cached.result); }
    publish({ phase: 'checking', message: 'Kontrol ediliyor…', detail: null });
    if (!pending.has(channel)) {
      const work = detect(channel).then(value => { cache.set(channel, { ...value, at: Date.now() }); return value; })
        .catch(e => ({ error: e })).finally(() => pending.delete(channel));
      pending.set(channel, work);
    }
    const value = await pending.get(channel);
    if (channel !== releasesOnly || applying) return getState();
    if (value.error) return publish(errorState(value.error));
    target = value.target; return publish(value.result);
  }
  async function setChannel(on) {
    if (applying) return getState();
    const st = readState(); st.updatesReleasesOnly = !!on; writeState(st, true);
    releasesOnly = !!on;
    target = null; publish({ phase: 'idle', available: false, localNewer: false, needsInstaller: false, latest: null, message: 'Henüz kontrol edilmedi.', detail: null });
    return check();
  }
  async function apply() {
    if (!packaged) return publish({ message: 'Geliştirme modunda güncelleme yükleme kapalı.' });
    if (applying || state.phase === 'checking') return getState();
    if (!target || !state.available || state.needsInstaller) return getState();
    if (!['darwin', 'win32'].includes(platform)) return publish({ phase: 'error', message: 'Bu sistemde uygulama güncellemesi desteklenmiyor.' });
    const chosen = target, current = app.getAppPath();
    let temp = null, stage = null, failure = null, restored = false;
    const bundle = platform === 'darwin' ? bundleFor(current) : null;
    const sign = () => signer().signApp(bundle);
    applying = true; publish({ phase: 'downloading', message: 'İndiriliyor…', detail: null });
    try {
      await cleanup;
      try { await fsp.access(path.dirname(current), fs.constants.W_OK); }
      catch (e) { throw userError('Uygulama klasörüne yazılamıyor; uygulamayı Uygulamalar klasörüne kurulum betiğiyle kur', e); }
      temp = await fsp.mkdtemp(path.join(app.getPath('temp'), 'volkan-update-'));
      const archive = path.join(temp, 'update.tar.gz');
      await request('https://codeload.github.com/' + REPO + '/tar.gz/' + chosen.latest.sha,
        r => pipeline(Readable.fromWeb(r.body), fs.createWriteStream(archive)));
      publish({ phase: 'installing', message: 'Kuruluyor…' });
      const extracted = await extractApp(archive, path.join(temp, 'unpacked'), chosen.files, run, platform);
      // Stage on the destination volume so both renames work on Windows and across temp volumes.
      stage = await fsp.mkdtemp(path.join(path.dirname(current), 'app.new-'));
      const incoming = path.join(stage, 'app');
      await fsp.cp(extracted, incoming, { recursive: true });
      await verifyApp(incoming, chosen.files);
      await fsp.writeFile(path.join(incoming, 'build-info.json'), JSON.stringify({
        commit: chosen.latest.sha, dirty: false, built: new Date().toISOString()
      }) + '\n');
      if (platform === 'darwin') await fsp.rm(path.join(incoming, 'icon.ico'), { force: true });
      const backup = path.join(temp, 'app.rollback');
      let backupReady = false;
      await swapApp(current, incoming, { platform, stop: () => media.stop(),
        prepareRestore: async old => {
          await fsp.rm(receiptPath(), { force: true }).catch(() => {});
          if (backupReady) {
            try {
              await fsp.rm(old, { recursive: true, force: true });
              await fsp.cp(backup, old, { recursive: true });
            } catch (e) {
              // A partial copy is never a rollback source; keep the complete new app.
              temp = null;
              throw userError('Eski uygulama kopyalanamadı; yeni uygulama korundu.',
                { message: (e.detail || e.message) + '\nGeri alma kopyası: ' + backup });
            }
          }
        },
        afterRestore: async () => { restored = true; },
        afterSwap: async old => {
          if (bundle) {
            // codesign seals Resources: keeping app.old or staging files here would invalidate
            // the signature when we delete them. Retain rollback files outside the bundle.
            await fsp.cp(old, backup, { recursive: true }); backupReady = true;
            await fsp.rm(old, { recursive: true });
            await fsp.rm(stage, { recursive: true });
          }
          await fsp.mkdir(app.getPath('userData'), { recursive: true });
          await fsp.writeFile(receiptPath(), JSON.stringify(chosen.latest));
          if (bundle) await sign();
      } });
    } catch (e) { failure = e; }
    finally {
      if (stage) await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      if (temp) await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
      // Seal only after cleanup: deleting staging afterwards would invalidate it.
      if (bundle && restored) {
        try { await sign(); }
        catch (e) { e.detail = (failure?.detail || failure?.message || '') + '\n' + e.detail; failure = e; }
      }
      applying = false;
    }
    if (failure) {
      const result = publish(errorState(failure));
      if (quitRequested) { quitRequested = false; app.quit(); }
      return result;
    }
    if (quitRequested) { quitRequested = false; app.quit(); return getState(); }
    app.releaseSingleInstanceLock(); app.relaunch(); app.exit(0);
    return getState();
  }
  function start() {
    try { receipt = JSON.parse(fs.readFileSync(receiptPath(), 'utf8')); } catch (e) {}
    if (packaged && !applying) cleanup = cleanup.then(async () => {
      const current = app.getAppPath();
      let changed = false;
      const remove = async p => {
        try { await fsp.lstat(p); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
        changed = true;
        await fsp.rm(p, { recursive: true, force: true });
      };
      const removeMatching = async (dir, prefix) => {
        for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.startsWith(prefix))
            await remove(path.join(dir, entry.name));
        }
      };
      try {
        await remove(current + '.old');
        await remove(current + '.failed');
        await removeMatching(path.dirname(current), 'app.new-');
      } finally {
        if (platform === 'darwin' && changed) {
          await signer().signApp(bundleFor(current));
        }
      }
      await removeMatching(app.getPath('temp'), 'volkan-update-');
      // Ad-hoc identities still change with content. Migrate to the local certificate once.
      // apply() awaits cleanup, including an already running migration, before changing files.
      if (platform === 'darwin' && !applying) {
        try {
          const bundle = bundleFor(current);
          const output = await run('/usr/bin/codesign', ['-dr', '-', bundle]);
          const text = typeof output === 'string' ? output : [output?.stdout, output?.stderr].join('\n');
          const requirement = text.match(/^designated\s*=>\s*(.+)$/m)?.[1].trim();
          if (!requirement?.includes('certificate leaf')) {
            const identity = await signer().ensureIdentity();
            if (identity) await signer().signApp(bundle, identity);
            else console.error('macOS yerel imza kimliği oluşturulamadı.');
          }
        } catch (e) { console.error('macOS imza geçişi tamamlanamadı.'); }
      }
    }).catch(() => { console.error('macOS imza temizliği tamamlanamadı.'); });
    timers = [setTimeout(() => check(), 15e3), setInterval(() => check(), 6 * 60 * 60e3)];
    return getState();
  }
  function acknowledge() {
    if (receipt) { fs.rmSync(receiptPath(), { force: true }); receipt = null; }
    return getState();
  }
  function stop() { timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers = []; }
  app.on('before-quit', event => {
    if (applying) { event.preventDefault(); quitRequested = true; }
  });
  return { getState, check, apply, setChannel, start, stop, acknowledge };
}
module.exports = { createUpdater, blobHash, appFiles, differences, verifyApp, extractApp, swapApp, bundleFor, isInstalledApp, REPO_URL };
