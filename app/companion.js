// Desktop-app additions on top of the settings page (only active inside the Volkan Deck app)
(function () {
  if (!window.deck) return;
  const OS = deck.platform;                 // 'win32' | 'darwin'
  const HOST = OS === 'darwin' ? 'mac' : 'win';
  const MIN_FW = '1.2.0';
  document.title = 'Volkan Deck';
  if (OS === 'darwin') {
    const example = document.querySelector('#view-proto .panel:nth-child(2) pre');
    if (example) example.textContent = '{"method":"search","value":"Spotify"}\n  → Cmd+Space · bekle · yaz · Enter\n\n{"method":"key","mods":["win"],"key":"SPACE"}\n  → Cmd+Space';
  }
  if (OS === 'darwin') {
    METHODS[0][1] = 'Uygulama adıyla aç'; METHODS[0][2] = 'Cihaz Spotlight ile uygulamanın adını arar.';
    METHODS[1][1] = 'Spotlight ile ara'; METHODS[1][2] = "Cihaz Spotlight'a adı yazar ve Enter'a basar.";
  }
  let connecting = false, busy = false, direct = false;

  /* ---- app updates: main process owns networking, verification and installation ---- */
  let updateState = null, updateNoticeShown = false;
  const updateStatus = el('span', { class: 'fwstate', role: 'status', 'aria-live': 'polite' }, 'Henüz kontrol edilmedi.');
  const updateDetail = el('p', { class: 'hint' });
  const updateMessage = el('p', { class: 'hint', hidden: true });
  const updateNotice = el('p', { class: 'hint', hidden: true });
  const updateChannel = el('input', { type: 'checkbox', onchange: async e => {
    try { renderUpdate(await deck.updateChannel(e.target.checked)); } catch (err) { toast('Ayar kaydedilemedi: ' + err.message); }
  } });
  const updateCheck = el('button', { class: 'btn', onclick: async () => {
    try { renderUpdate(await deck.checkUpdates()); } catch (err) { toast('Güncelleme kontrol edilemedi: ' + err.message); }
  } }, 'Güncellemeleri kontrol et');
  const updateApply = el('button', { class: 'btn primary', disabled: true, onclick: async () => {
    try { renderUpdate(await deck.applyUpdate()); } catch (err) { toast('Güncelleme yüklenemedi: ' + err.message); }
  } }, 'Güncelle ve yeniden başlat');
  const updateRepo = el('button', { class: 'btn', hidden: true, onclick: () => deck.openUpdateRepo() }, 'GitHub sayfasını aç');
  const updateBox = el('div', { class: 'panel', id: 'appUpdate', style: 'margin-bottom:16px;scroll-margin-top:16px' },
    el('div', { class: 'panel-h' }, el('h2', {}, 'Uygulama güncellemesi'), updateStatus),
    el('div', { class: 'panel-b' }, updateNotice, updateDetail, updateMessage,
      el('label', { class: 'row', style: 'cursor:pointer' }, updateChannel, 'Sadece yayınlanan sürümler (Releases)'),
      el('div', { class: 'row' }, updateCheck, updateApply, updateRepo)));
  document.getElementById('view-device').prepend(updateBox);
  function openUpdates() {
    document.querySelector('nav.tabs button[data-view="device"]')?.click();
    updateBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderStatus();                         // keep the embedded firmware hint in this same view
  }
  function relativeUpdateDate(date) {
    const seconds = (new Date(date).getTime() - Date.now()) / 1000;
    if (!Number.isFinite(seconds)) return '';
    const r = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
    for (const [unit, size] of [['year', 31536e3], ['month', 2592e3], ['day', 86400], ['hour', 3600], ['minute', 60]])
      if (Math.abs(seconds) >= size) return r.format(Math.round(seconds / size), unit);
    return r.format(Math.round(seconds), 'second');
  }
  function renderUpdate(s) {
    if (!s) return;
    updateState = s;
    const working = ['checking', 'downloading', 'installing'].includes(s.phase);
    updateStatus.textContent = ({ current: 'Güncel', available: 'Güncelleme var', checking: 'Kontrol ediliyor…', downloading: 'İndiriliyor…', installing: 'Kuruluyor…', error: 'Hata' })[s.phase] || s.message;
    updateMessage.textContent = s.message; updateMessage.hidden = s.phase !== 'error' && !s.needsInstaller;
    updateDetail.textContent = s.latest ? s.latest.message + ' · ' + s.latest.author + ' · ' + relativeUpdateDate(s.latest.date) : '';
    updateDetail.hidden = !s.latest;
    updateCheck.disabled = working; updateChannel.disabled = working; updateChannel.checked = s.releasesOnly;
    updateApply.disabled = working || !s.packaged || !s.available || s.needsInstaller;
    updateApply.textContent = !s.packaged ? 'Geliştirme modunda yükleme kapalı' : s.phase === 'downloading' ? 'İndiriliyor…' : s.phase === 'installing' ? 'Kuruluyor…' : 'Güncelle ve yeniden başlat';
    updateRepo.hidden = !s.needsInstaller;
    if (s.receipt && !updateNoticeShown) {
      updateNoticeShown = true;
      updateNotice.textContent = 'Güncellendi: ' + s.receipt.message; updateNotice.hidden = false;
      toast(updateNotice.textContent); openUpdates();
      deck.acknowledgeUpdate().catch(() => {});
    }
  }
  deck.onUpdateState(renderUpdate); deck.onUpdateOpen(openUpdates);
  deck.updateState().then(renderUpdate).catch(() => {});
  setInterval(() => { if (updateState) renderUpdate(updateState); }, 60e3);

  /* ---- automatic connection (main process picks the deck's port, no chooser) ---- */
  // USB first; with no cable to this computer, the deck's Bluetooth data channel (firmware 1.6.0+)
  let bleReady = null, bleTriedAt = 0;
  const usbDeck = async () => { try { return (await navigator.serial.getPorts()).some(p => p.getInfo().usbVendorId === ESP_VID); } catch (e) { return false; } };
  window.__deckAutoConnect = async () => {
    if (connecting || busy) return;
    if (port && !(port.isBle && await usbDeck())) return;     // cable plugged in while on Bluetooth: move to USB
    connecting = true;
    try {
      if (port) await disconnect();
      // Bluetooth first when it is due: requestDevice needs the fresh user activation this call carries
      const bleDue = !(await usbDeck()) && cfg.device.connection !== 'usb' && Date.now() - bleTriedAt > 12000;
      if (bleDue) {
        if (!('bluetooth' in navigator)) { if (bleReady !== false) log('er', '  Bluetooth: bu pencerede Web Bluetooth yok'); bleReady = false; }
        if (bleReady === null) {
          bleReady = await deck.bleReady().catch(() => false);
          if (!bleReady) log('er', '  Bluetooth kapalı: Mac-Kur.command bir kez yeniden çalıştırılmalı (Bluetooth izni).');
        }
        if (bleReady) {
          bleTriedAt = Date.now();
          const avail = await navigator.bluetooth.getAvailability?.().catch(() => true);
          if (avail === false) log('er', '  Bluetooth: bilgisayarın Bluetooth\'u kapalı ya da uygulamanın izni yok');
          else await connect(true, true);
        }
      }
      if (!port) await connect(true);
    } catch (e) { log('er', '  Bağlantı: ' + (e && e.message || e)); } finally { connecting = false; }
    if (port && deviceInfo) await afterConnect();
  };
  async function afterConnect() {
    checkedPort = port;
    direct = false;
    if (!deviceInfo.fw || !verGE(deviceInfo.fw, MIN_FW)) {
      serialNote('Uygulamaları doğrudan açmak için kartta firmware v' + MIN_FW + ' gerekiyor (kartta v' + (deviceInfo.fw || '?') + ' var). Cihaz ayarları → Firmware yükle ile güncelle; o zamana kadar cihaz eski klavye yöntemiyle açar.');
      fwNeeded = true; renderStatus(); renderEditor();
    } else {
      try { await send({ cmd: 'companion', os: HOST, mediaLaunch: true, ack: true }, 2500, true); direct = true; } catch (e) {}
    }
    pushStatus();
    await pollStats(true);
  }
  // flashing needs the port to itself
  const _flashTo = flashTo;
  flashTo = async function (p) { busy = true; try { return await _flashTo(p); } finally { busy = false; } };

  /* ---- heartbeat: while this arrives, the deck sends launch events instead of typing ---- */
  let checkedPort = null;
  setInterval(() => {
    // the page may have connected on its own (already-allowed port): run the direct-mode handshake once per connection
    if (port && deviceInfo && checkedPort !== port && !connecting && !busy) { checkedPort = port; afterConnect(); }
    if (writer && deviceInfo && direct && !busy) sendRaw({ cmd: 'companion', os: HOST, mediaLaunch: true });
    if (!port) direct = false;
    pushStatus();
  }, 2000);
  function pushStatus() {
    const on = !!(port && deviceInfo);
    deck.status({ connected: on, direct: on && direct, text: on ? (deviceInfo.name || 'Volkan Deck') + (deviceInfo.fw ? ' · v' + deviceInfo.fw : '') + (port.isBle ? ' · Bluetooth' : '') : 'Bağlı değil' });
    const ct = document.getElementById('connText');
    if (on && ct) ct.textContent = (deviceInfo.name || 'Cihaz') + (deviceInfo.fw ? ' · v' + deviceInfo.fw : '') + (port.isBle ? ' · Bluetooth' : '') + (direct ? ' · doğrudan açma' : '');
  }

  /* ---- the deck asked us to open an app ---- */
  window.onDeckLaunch = async m => {
    log('rx', '← aç: ' + (m.name || m.app));
    const a = cfg.apps.find(x => x.id === m.app);       // local settings fill in what the deck doesn't know yet
    if (a) Object.assign(m, { name: a.name, method: a.launch.method, value: a.launch.value, path: a.targets?.win || a.launch.path || '', mac: a.targets?.mac || a.launch.mac || '', bg: !!a.bg });
    const r = await deck.launch(m);
    if (r && r.ok) log('', '  açıldı (' + r.how + ')');
    else {
      const msg = (m.name || 'Uygulama') + ' açılamadı: ' + (r && r.error || 'bilinmeyen hata');
      log('er', '  ' + msg); toast(msg); deck.notify('Volkan Deck', msg);
    }
  };

  /* ---- optional Windows CPU sensor driver: explicit consent and one UAC ---- */
  if (OS === 'win32') {
    let sensorWorking = false, sensorInstalled = false, sensorStatusRevision = 0;
    const sensorNote = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite', style: 'white-space:pre-line' }, 'CPU sıcaklığı için bir kez yönetici onayı gerekir.');
    const consentText = el('p', { class: 'hint' });
    const consentConfirm = el('button', { class: 'btn primary' });
    const consentCancel = el('button', { class: 'btn', onclick: () => { sensorConsent.hidden = true; } }, 'Vazgeç');
    const sensorConsent = el('div', { hidden: true }, consentText, el('div', { class: 'row' }, consentConfirm, consentCancel));
    function renderSensorButtons() {
      sensorButton.disabled = sensorWorking; sensorRemove.disabled = sensorWorking;
      sensorRemove.hidden = !sensorInstalled;
      sensorButton.textContent = sensorInstalled ? 'Sensör kurulumunu yenile' : 'CPU sıcaklığı için sürücüyü kur';
    }
    async function performSensorAction(remove) {
      if (sensorWorking) return;
      sensorStatusRevision++;
      sensorWorking = true; sensorConsent.hidden = true; renderSensorButtons();
      sensorNote.textContent = remove ? 'Windows yönetici onayı isteyecek; sensör kurulumu kaldırılıyor…' : 'Dosyalar doğrulanıyor; Windows yönetici onayı isteyecek…';
      try {
        const r = await (remove ? deck.uninstallSensors() : deck.installSensors());
        sensorNote.textContent = r.message;
        if (r.ok) sensorInstalled = !remove;
        // Check partial installs/removals too, without replacing the detailed result.
        try { const s = await deck.sensorStatus(); sensorInstalled = s.installed; } catch (_) {}
      } catch (e) { sensorNote.textContent = (remove ? 'Sensör kaldırılamadı: ' : 'Sensör kurulamadı: ') + e.message; }
      finally { sensorWorking = false; renderSensorButtons(); }
    }
    function askSensorConsent(remove) {
      if (sensorWorking) return;
      consentText.textContent = remove
        ? 'Bu kullanıcıya ait sensör görevi ve dosyaları kaldırılacak. PawnIO yalnız Volkan Deck kurduysa ve başka bir Windows kullanıcısının sensör görevi yoksa kaldırılır. CPU sıcaklığı “—” görünecek. Devam edilsin mi?'
        : 'Windows CPU sıcaklığını yalnız bir sürücü üzerinden okuyabildiği için imzalı, açık kaynaklı ve çekirdek düzeyinde çalışan PawnIO sürücüsü kurulacak. Bu kullanıcı her oturum açtığında sensörü yönetici yetkileriyle okuyan bir başlangıç görevi de kurulacak. Ağda dinleyen hiçbir hizmet yoktur. Kurulumu “Kaldır” düğmesiyle kaldırabilirsiniz.';
      consentConfirm.textContent = remove ? 'Kaldır' : 'Anladım, kur';
      consentConfirm.onclick = () => performSensorAction(remove);
      sensorConsent.hidden = false; consentConfirm.focus();
    }
    const sensorButton = el('button', { class: 'btn', onclick: () => askSensorConsent(false) }, 'CPU sıcaklığı için sürücüyü kur');
    const sensorRemove = el('button', { class: 'btn', hidden: true, onclick: () => askSensorConsent(true) }, 'Sensör sürücüsünü kaldır');
    const sensorBox = el('div', { class: 'panel', style: 'margin-bottom:16px' },
      el('div', { class: 'panel-h' }, el('h2', {}, 'CPU sıcaklığı')),
      el('div', { class: 'panel-b' }, sensorNote, el('div', { class: 'row' }, sensorButton, sensorRemove), sensorConsent,
        el('p', { class: 'hint' }, 'PawnIO sürücüsü ve yalnız sensör okuyan bir oturum açılış görevi kurulur. Kurmazsan CPU yükü çalışır; sıcaklık “—” görünür.')));
    updateBox.after(sensorBox);
    const revision = sensorStatusRevision;
    deck.sensorStatus().then(s => {
      if (revision !== sensorStatusRevision) return;
      sensorInstalled = s.installed; renderSensorButtons();
      if (s.installed) sensorNote.textContent = s.live ? 'Sensör görevi çalışıyor.' : 'Sensör kurulmuş; değer bekleniyor. Gerekirse kurulumu yenile.';
    }).catch(() => {});
  }

  /* ---- automatic weather location, including while the deck is disconnected ---- */
  let locationPolling = false, geoAttempted = false, geoAt = 0, geoOK = false;
  const geoKey = KEY + '.location-attempt';
  async function requestLocation(retry = false) {
    if (!cfg.home?.weather?.auto || locationPolling) return;
    locationPolling = true;
    weatherLocationStatus = 'Konum aranıyor…';
    const status = document.getElementById('wxLocationStatus'); if (status) status.textContent = weatherLocationStatus;
    try {
      await deck.stats({ weather: cfg.home.weather, geolocation: { pending: true } });
      let geo = null, previous = '';
      try { previous = localStorage.getItem(geoKey) || ''; } catch (_) {}
      let allowed = retry || !previous;
      if (!allowed && previous === 'granted') {
        try { allowed = (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch (_) {}
      }
      if (allowed && navigator.geolocation && await deck.locationAvailable()) {
        try { localStorage.setItem(geoKey, 'attempted'); } catch (_) {}
        geo = await new Promise(resolve => {
          const timer = setTimeout(() => resolve(null), 15000);
          navigator.geolocation.getCurrentPosition(p => { clearTimeout(timer); resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); }, () => { clearTimeout(timer); resolve(null); }, { timeout: 15000, maximumAge: 3600000, enableHighAccuracy: false });
        });
        if (geo) { try { localStorage.setItem(geoKey, 'granted'); } catch (_) {} }
      }
      geoAttempted = true; geoAt = Date.now(); geoOK = !!geo;
      await deck.stats({ weather: cfg.home.weather, geolocation: geo });
    } catch (_) {
      geoAttempted = true; geoAt = Date.now(); geoOK = false;
      await deck.stats({ weather: cfg.home.weather, geolocation: null }).catch(() => {});
    } finally { locationPolling = false; }
    pollLocation();
  }
  window.retryWeatherLocation = () => requestLocation(true);
  async function pollLocation() {
    if (locationPolling || !cfg.home?.weather?.auto || ['downloading', 'installing'].includes(updateState?.phase)) return;
    if (!geoAttempted || (geoOK && Date.now() - geoAt >= 3600000)) { requestLocation(); return; }
    weatherLocationFailed = geoAttempted && !geoOK;
    for (const id of ['wxLocationSettings', 'wxLocationHint']) { const e = document.getElementById(id); if (e) e.hidden = !weatherLocationFailed; }
    locationPolling = true;
    try {
      const snapshot = await deck.stats({ weather: cfg.home.weather });
      if (!cfg.home?.weather?.auto) return;
      const loc = snapshot.location;
      weatherLocationStatus = loc?.error || (loc?.pending ? 'Konum aranıyor…' : '');
      weatherLocationSource = loc?.source || '';
      if (loc?.city) {
        const w = cfg.home.weather;
        if (w.city !== loc.city || w.lat !== loc.lat || w.lon !== loc.lon) { Object.assign(w, { city: loc.city, lat: loc.lat, lon: loc.lon }); save(); drawScreen(); renderJson(); }
      }
      const selected = document.getElementById('wxSelected'), status = document.getElementById('wxLocationStatus');
      if (selected) selected.textContent = weatherLocationLabel();
      if (status) status.textContent = weatherLocationStatus;
    } catch (_) { weatherLocationStatus = 'Konum bulunamadı'; const status = document.getElementById('wxLocationStatus'); if (status) status.textContent = weatherLocationStatus; }
    finally { locationPolling = false; }
  }
  pollLocation(); setInterval(pollLocation, 5000);

  /* ---- cached widget groups (firmware 1.4.0+), full snapshot after reconnect ---- */
  const statsRates = { cpu: 1000, gpu: 1000, net: 1000, time: 60000, weather: 900000, fx: 1800000 };
  let statsPolling = false, statsPort = null, statsWriter = null;
  let statsSent = {}, statsSlow = {};
  async function pollStats(full = false) {
    if (statsPolling || busy || !writer || !deviceInfo?.fw || !verGE(deviceInfo.fw, '1.4.0')) return;
    if (updateState && ['downloading', 'installing'].includes(updateState.phase)) return;
    statsPolling = true;
    const link = writer, connectedPort = port;
    try {
      const snapshot = await deck.stats({ weather: cfg.home?.weather || null });
      if (writer !== link || port !== connectedPort || busy || !deviceInfo?.fw || !verGE(deviceInfo.fw, '1.4.0')) return;
      if (statsPort !== port || statsWriter !== writer) { full = true; statsSent = {}; statsSlow = {}; statsPort = port; statsWriter = writer; }
      const now = Date.now(), groups = {};
      for (const [group, rate] of Object.entries(statsRates)) {
        if (!snapshot[group]) continue;
        const slow = group === 'weather' || group === 'fx', value = slow ? JSON.stringify(snapshot[group]) : '';
        // First successful slow response / a newly chosen city should appear immediately.
        if (full || !statsSent[group] || now - statsSent[group] >= rate || (slow && statsSlow[group] !== value)) {
          groups[group] = snapshot[group]; statsSent[group] = now; if (slow) statsSlow[group] = value;
        }
      }
      if (!Object.keys(groups).length) return;
      await sendRaw({ cmd: 'stats', ...groups });
      window.onDeckStats?.(groups);
    } catch (e) {} finally { statsPolling = false; }
  }
  setInterval(() => pollStats(), 1000);

  /* ---- media + volume/brightness pages (firmware 1.3.0+): this computer feeds the deck ---- */
  const MEDIA_FW = '1.3.0';
  let mediaTarget = (cfg.pages && cfg.pages.media && cfg.pages.media.player) || 'auto';
  let lastArtKey, wantArtKey = '', wantArtAt = 0, artGeneration = 0, mediaRevision = 0, artBusy = false, deckPage = '', controlling = 0, controlAt = 0;
  window.onDeckSerialOpen = () => { lastArtKey = undefined; wantArtKey = ''; artGeneration++; mediaRevision++; deckPage = ''; };
  const pagesOn = () => { const p = cfg.pages || {}; return { media: !p.media || p.media.enabled !== false, sys: !p.system || p.system.enabled !== false }; };
  const hostReady = () => !(updateState && ['downloading', 'installing'].includes(updateState.phase)) && !busy && !!writer && !!deviceInfo && direct && !!deviceInfo.fw && verGE(deviceInfo.fw, MEDIA_FW);
  // One poll in flight per lane; a concurrent run requests one more after completion.
  function createPollRunner(poll, cadence, timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) }) {
    let active = false, again = false, timer = null;
    async function run() {
      if (timer != null) { timers.clearTimeout(timer); timer = null; }
      if (active) { again = true; return; }
      active = true;
      try { do { again = false; await poll(); } while (again); }
      catch (e) { console.error('Bilgisayar sorgusu', e); }
      finally { active = false; timer = timers.setTimeout(run, cadence()); }
    }
    return run;
  }
  // Media: 0.5 s playing, 1 s paused; other pages 2 s, unknown 1 s. Bluetooth: at most 1/s.
  function mediaCadence() {
    const ms = deckPage === 'media' ? (hostDemo.media.playing ? 500 : 1000) : deckPage ? 2000 : 1000;
    return port?.isBle ? Math.max(ms, 1000) : ms;
  }
  const sysCadence = () => deckPage === 'system' || deckPage === 'media' ? 1000 : 2000;
  const controlBusy = () => controlling > 0 && performance.now() - controlAt < 3000;
  async function pollMedia() {
    if (!hostReady() || !pagesOn().media || controlBusy()) return;
    const link = writer, revision = mediaRevision, generation = artGeneration, started = performance.now();
    const st = await deck.hostState({ target: mediaTarget, launch: cfg.pages?.media?.launch, media: true, sys: false });
    // A button press or reconnect makes this answer stale.
    if (writer !== link || revision !== mediaRevision || generation !== artGeneration || controlBusy() || !hostReady() || !st?.media) return;
    await sendRaw({ cmd: 'media', ...st.media }, () => revision === mediaRevision);
    Object.assign(hostDemo.media, st.media); hostDemo.at = performance.now();
    const key = st.media.artKey || '';
    if (hostDemo.artKey !== key) { hostDemo.art = null; hostDemo.artKey = key; }
    if (key !== wantArtKey) { wantArtKey = key; wantArtAt = started; }
    pushArt();                                            // cover loading never holds up media polling
  }
  // Wait up to 4 s for a cover; drop it if its track is no longer current.
  async function pushArt() {
    if (artBusy) return;
    artBusy = true;
    try {
      while (hostReady() && pagesOn().media && wantArtKey !== lastArtKey) {
        const key = wantArtKey, link = writer, generation = artGeneration;
        if (!key) { if (await sendRaw({ cmd: 'media_art', key: '' })) lastArtKey = ''; else break; continue; }
        const art = await deck.mediaArt(key, 4000);
        if (writer !== link || generation !== artGeneration) break;
        if (key !== wantArtKey) continue;                   // track changed while loading
        if (!art || art.key !== key) {
          if (lastArtKey && await sendRaw({ cmd: 'media_art', key: '' })) lastArtKey = '';
          break;
        }
        if (await sendRaw({ cmd: 'media_art', ...art }, () => writer === link && key === wantArtKey)) {
          lastArtKey = key; setMediaArt(art);
          if (deck.debug) console.log('[Volkan süre] kapak', Math.round(performance.now() - wantArtAt) + ' ms', '(sorgu başı → yazıldı)');
        } else if (writer === link && key === wantArtKey) break;
      }
    } catch (e) { console.error('Kapak', e); } finally { artBusy = false; }
  }
  async function pollSys() {
    if (!hostReady() || !pagesOn().sys) return;
    const link = writer;
    const st = await deck.hostState({ target: mediaTarget, media: false, sys: true });
    if (writer !== link || !hostReady() || !st?.sys) return;
    if (st.sys.vol != null) Object.assign(hostDemo.sys, { vol: st.sys.vol, mute: !!st.sys.mute, bright: st.sys.bright ?? hostDemo.sys.bright, micMute: st.sys.micMute ?? null });
    await sendRaw({ cmd: 'sys', vol: st.sys.vol, mute: !!st.sys.mute, bright: st.sys.bright, micMute: st.sys.micMute ?? null });
  }
  window.onDeckSelect = id => {
    const was = deckPage; deckPage = String(id || '');
    if (deckPage !== was && (deckPage === 'media' || was === 'media')) runMedia();
    if (deckPage === 'system' && was !== 'system') runSys();
  };
  window.onDeckMedia = async m => {
    if (m.player) { mediaTarget = m.player; pageState.player = m.player; }
    mediaRevision++;
    if (m.action === 'select') { log('rx', '← oynatıcı: ' + mediaTarget); runMedia(); return; }
    controlling++; controlAt = performance.now();
    try {
      const r = await deck.mediaControl(m.action, mediaTarget, { launch: cfg.pages.media.launch });
      if (!r || !r.ok) log('er', '  medya: ' + (r && r.error || 'hata'));
    } catch (e) { log('er', '  medya: ' + e.message); }
    finally { controlling--; mediaRevision++; runMedia(); }
  };
  // volume / brightness changes arrive every ~60 ms while the knob turns: keep only the newest, one call at a time
  let sysPending = null, sysBusy = false;
  window.onDeckSys = async m => {
    sysPending = { ...(sysPending || {}), ...(m.vol != null ? { vol: m.vol } : {}), ...(m.mute != null ? { mute: m.mute } : {}), ...(m.micMute != null ? { micMute: m.micMute } : {}), ...(m.bright != null ? { bright: m.bright } : {}) };
    if (sysBusy) return;
    sysBusy = true;
    try { while (sysPending) { const p = sysPending; sysPending = null; await deck.sysSet(p); } }
    finally { sysBusy = false; }
  };

  const runMedia = createPollRunner(pollMedia, mediaCadence), runSys = createPollRunner(pollSys, sysCadence);
  runMedia(); runSys();

  /* ---- per-app direct targets in the editor ---- */
  const _renderEditor = renderEditor;
  renderEditor = function () { _renderEditor.apply(this, arguments); try { addTargetBox(); } catch (e) { console.error(e); } };
  async function iconFromDataUrl(a, url) {
    if (!url) return;
    try { const r = await blobToIcon(await (await fetch(url)).blob()); a.iconData = r.data; a.color = r.color; } catch (e) {}
  }
  function syncFallbackFields(a) {
    const fields = document.getElementById('fallbackFields');
    fields?.replaceChildren(methodFields(a, () => { save(); drawScreen(); renderList(); renderCtlMap(); }));
    document.querySelectorAll('#launchAdvanced [data-method]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.method === a.launch.method)));
    const sum = document.getElementById('sumTxt'); if (sum) sum.textContent = launchSummary(a.launch);
  }
  function addTargetBox() {
    if (edit.kind !== 'app') return;
    const a = appById(edit.id), advanced = document.getElementById('launchAdvanced'); if (!a || !advanced) return;
    const special = a.launch.method === 'key' || (a.launch.method === 'taskbar' && !a.targets?.[OS === 'darwin' ? 'mac' : 'win'] && !a.launch.path && !a.launch.mac);
    if (special) {
      const note = el('p', { class: 'hint' }, 'Bu uygulama kısayol tuşuyla açılıyor'); advanced.before(note);
      if (a.launch.method === 'key') return;
    }
    a.targets ||= { win: a.launch.path || '', mac: a.launch.mac || '' };
    const k = OS === 'darwin' ? 'mac' : 'win';
    const initial = a.targets[k] || (OS === 'darwin' ? a.launch.method === 'run' && /^[a-z][a-z0-9+.-]+:/i.test(a.launch.value || '') ? a.launch.value : a.name : typeof a.launch.value === 'string' ? a.launch.value : '');
    const box = el('div', { class: 'srcbox', id: 'directBox' });
    const inp = el('input', { type: 'text', id: 'appTarget', 'aria-label': 'Ne açılsın', class: 'mono', value: initial, placeholder: OS === 'darwin' ? '/Applications/Spotify.app' : 'Program yolu veya adres', style: 'flex:1;min-width:120px', oninput: e => {
      const target = e.target.value.trim(); a.targets[k] = target; if (OS === 'win32') delete a.src;
      // A new typed path no longer belongs to the old shortcut's working directory.
      autoFallback(a, OS, target, null); save();
      syncFallbackFields(a);
    }, onchange: async () => {
      const target = a.targets[k]; if (OS !== 'win32' || !/\.(lnk|url)$/i.test(target)) return;
      try { const info = await deck.appInfo(target); if (a.targets[k] !== target) return; if (info.src) a.src = info.src; autoFallback(a, OS, target, info.src || null); save(); syncFallbackFields(a); }
      catch (_) {}
    } });
    const pick = el('button', { class: 'btn sm', onclick: async () => {
      pick.disabled = true;
      try {
        const list = await deck.pickApps(false), it = list?.[0]; if (!it) return;
        a.targets[k] = it.path; if (OS === 'win32') { if (it.src) a.src = it.src; else delete a.src; }
        autoFallback(a, OS, it.path, it.src || null);
        if (!a.iconData) await iconFromDataUrl(a, it.icon); changed(); toast('Seçildi: ' + it.name);
      } catch (e) { toast('Seçilemedi: ' + e.message); } finally { pick.disabled = false; }
    } }, 'Seç…');
    const test = el('button', { class: 'btn sm ghost', onclick: async () => {
      test.disabled = true;
      try { const r = await deck.launch({ app: a.id, name: a.name, method: a.launch.method, value: a.launch.value, path: a.targets.win, mac: a.targets.mac, bg: !!a.bg }); toast(r?.ok ? a.name + ' açıldı' : 'Açılamadı: ' + (r?.error || 'Bilinmeyen hata')); }
      catch (e) { toast('Denenemedi: ' + e.message); } finally { test.disabled = false; }
    } }, 'Dene');
    box.append(el('div', { class: 'field' }, el('span', {}, 'Ne açılsın'), el('div', { class: 'row' }, inp, pick, test)),
      el('p', { class: 'hint' }, OS === 'darwin' ? '.app seç veya uygulama adı / adres yaz.' : '.exe, .lnk, .url yolu veya adres yaz. Boşsa uygulama adı kullanılır.'),
      el('label', { class: 'row', style: 'cursor:pointer;align-items:flex-start' }, el('input', { type: 'checkbox', id: 'appBg', checked: !!a.bg, onchange: e => { a.bg = e.target.checked; save(); } }), 'Arka planda aç'));
    advanced.before(box);
  }

  /* ---- macOS: pick .app bundles with the native dialog, or drop them on the list ---- */
  if (OS === 'darwin') {
    async function addMacApps(list) {
      let last = null, dup = 0;
      for (const it of list) {
        if (!it || !it.path) continue;
        if (cfg.apps.length >= MAX_APPS) { toast('En fazla ' + MAX_APPS + ' uygulama'); break; }
        if (cfg.apps.some(x => x.targets && x.targets.mac === it.path)) { dup++; continue; }
        const a = { id: uid(), name: it.name.slice(0, 24), icon: guessIcon(it.name), color: '#64748B', inWheel: true, launch: { method: 'search', value: it.name }, targets: { win: '', mac: it.path } };
        await iconFromDataUrl(a, it.icon);
        cfg.apps.push(a); last = a;
      }
      save();
      if (last) { selectApp(last.id); toast(last.name + ' eklendi. Cihaza göndermek için “Cihaza yaz”.'); }
      else { renderAll(); if (dup) toast('Bu uygulama zaten listede'); }
    }
    const b = document.getElementById('btnBrowse');
    if (b) b.onclick = async () => {
      try { const list = await deck.pickApps(true); if (list && list.length) await addMacApps(list); }
      catch (e) { toast('Uygulama eklenemedi: ' + e.message); }
    };
    const _import = importFiles;
    importFiles = async function (files) {
      const arr = [...files], apps = [], rest = [];
      for (const f of arr) { const p = deck.pathForFile(f); if (/\.app\/?$/i.test(p)) apps.push(p.replace(/\/$/, '')); else if (OS === 'darwin' && /\.(exe|lnk|url)$/i.test(f.name)) toast('macOS için .app seç'); else rest.push(f); }
      if (apps.length) await addMacApps(await Promise.all(apps.map(p => deck.appInfo(p))));
      if (rest.length) return _import(rest);
    };
    const hint = b && b.closest('div') && [...document.querySelectorAll('.hint, p')].find(x => /\.exe, kısayol/.test(x.textContent));
    if (hint) hint.textContent = 'Uygulamalar klasöründen bir veya birkaç uygulama seç ya da Finder\'dan buraya sürükle. İkon ve ad kendiliğinden gelir.';
  }

  // Host style is applied only to the outgoing device config; the saved config stays stable.
  renderTplMenu(); renderEditor();
  deck.version().then(v => { const t = document.querySelector('.brand .sub'); if (t) t.textContent = 'Masaüstü v' + v; }).catch(() => {});
})();
