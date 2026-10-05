// Desktop-app additions on top of the settings page (only active inside the Volkan Deck app)
(function () {
  if (!window.deck) return;
  const OS = deck.platform;                 // 'win32' | 'darwin'
  const HOST = OS === 'darwin' ? 'mac' : 'win';
  const MIN_FW = '1.2.0';
  document.title = 'Volkan Deck';
  METHODS[0][1] = 'Dosya, adres veya komut'; METHODS[0][2] = 'Program yolu, kısayol, steam:// gibi adres ya da chrome gibi bir komut; arka planda doğrudan başlatılır.';
  METHODS[1][1] = 'Uygulama adı'; METHODS[1][2] = 'Adıyla Başlat menüsü kaydından (Mac\'te Uygulamalar\'dan) bulunup doğrudan başlatılır; arama açılmaz.';
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
  window.__deckAutoConnect = async () => {
    if (port || connecting || busy) return;
    connecting = true;
    try { await connect(true); } catch (e) {} finally { connecting = false; }
    if (port && deviceInfo) await afterConnect();
  };
  async function afterConnect() {
    checkedPort = port;
    direct = false;
    if (!deviceInfo.fw || !verGE(deviceInfo.fw, MIN_FW)) {
      serialNote('Uygulamaları doğrudan açmak için kartta firmware v' + MIN_FW + ' gerekiyor (kartta v' + (deviceInfo.fw || '?') + ' var). Cihaz ayarları → Firmware yükle ile güncelle; o zamana kadar cihaz eski klavye yöntemiyle açar.');
      fwNeeded = true; renderStatus(); renderEditor();
    } else {
      try { await send({ cmd: 'companion', os: HOST, ack: true }, 2500, true); direct = true; } catch (e) {}
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
    if (writer && deviceInfo && direct && !busy) sendRaw({ cmd: 'companion', os: HOST });
    if (!port) direct = false;
    pushStatus();
  }, 2000);
  function pushStatus() {
    const on = !!(port && deviceInfo);
    deck.status({ connected: on, direct: on && direct, text: on ? (deviceInfo.name || 'Volkan Deck') + (deviceInfo.fw ? ' · v' + deviceInfo.fw : '') : 'Bağlı değil' });
    const ct = document.getElementById('connText');
    if (on && ct) ct.textContent = (deviceInfo.name || 'Cihaz') + (deviceInfo.fw ? ' · v' + deviceInfo.fw : '') + (direct ? ' · doğrudan açma' : '');
  }

  /* ---- the deck asked us to open an app ---- */
  window.onDeckLaunch = async m => {
    log('rx', '← aç: ' + (m.name || m.app));
    const a = cfg.apps.find(x => x.id === m.app);       // local settings fill in what the deck doesn't know yet
    if (a) { m.path = m.path || (a.targets && a.targets.win) || ''; m.mac = m.mac || (a.targets && a.targets.mac) || ''; m.bg = !!a.bg; }
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
  let mediaTarget = (cfg.pages && cfg.pages.media && cfg.pages.media.player) || 'auto', polling = false;
  let lastArtKey, artGeneration = 0;
  window.onDeckSerialOpen = () => { lastArtKey = undefined; artGeneration++; };
  const pagesOn = () => { const p = cfg.pages || {}; return { media: !p.media || p.media.enabled !== false, sys: !p.system || p.system.enabled !== false }; };
  async function pollHost() {
    if (updateState && ['downloading', 'installing'].includes(updateState.phase)) return;
    if (polling || busy || !writer || !deviceInfo || !direct || !deviceInfo.fw || !verGE(deviceInfo.fw, MEDIA_FW)) return;
    const on = pagesOn(); if (!on.media && !on.sys) return;
    polling = true;
    const serialWriter = writer, generation = artGeneration;
    try {
      const st = await deck.hostState({ target: mediaTarget, media: on.media, sys: on.sys });
      if (writer !== serialWriter || generation !== artGeneration) return;
      if (st && st.media) {
        await sendRaw({ cmd: 'media', ...st.media }); Object.assign(hostDemo.media, st.media); hostDemo.at = performance.now();
        const key = st.media.artKey || '';
        if (hostDemo.artKey !== key) { hostDemo.art = null; hostDemo.artKey = key; }
        if (key !== lastArtKey) {
          const art = key ? await deck.mediaArt(key) : null;
          if (writer !== serialWriter || generation !== artGeneration) return;
          if (art && art.key === key) { await sendRaw({ cmd: 'media_art', ...art }); lastArtKey = key; setMediaArt(art); }
          else if (lastArtKey !== '') { await sendRaw({ cmd: 'media_art', key: '' }); lastArtKey = ''; }
        }
      }
      if (st && st.sys && st.sys.vol != null) Object.assign(hostDemo.sys, { vol: st.sys.vol, mute: !!st.sys.mute, bright: st.sys.bright ?? hostDemo.sys.bright });
      if (st && st.sys) await sendRaw({ cmd: 'sys', vol: st.sys.vol, mute: !!st.sys.mute, bright: st.sys.bright });
    } catch (e) {} finally { polling = false; }
  }
  setInterval(pollHost, 2000);
  window.onDeckMedia = async m => {
    if (m.player) mediaTarget = m.player;
    if (m.action === 'select') { log('rx', '← oynatıcı: ' + mediaTarget); setTimeout(pollHost, 50); return; }
    const r = await deck.mediaControl(m.action, mediaTarget);
    if (!r || !r.ok) log('er', '  medya: ' + (r && r.error || 'hata'));
    setTimeout(pollHost, 300);
  };
  // volume / brightness changes arrive every ~60 ms while the knob turns: keep only the newest, one call at a time
  let sysPending = null, sysBusy = false;
  window.onDeckSys = async m => {
    sysPending = { ...(sysPending || {}), ...(m.vol != null ? { vol: m.vol } : {}), ...(m.mute != null ? { mute: m.mute } : {}), ...(m.bright != null ? { bright: m.bright } : {}) };
    if (sysBusy) return;
    sysBusy = true;
    try { while (sysPending) { const p = sysPending; sysPending = null; await deck.sysSet(p); } }
    finally { sysBusy = false; }
  };

  /* ---- per-app direct targets in the editor ---- */
  const _renderEditor = renderEditor;
  renderEditor = function () { _renderEditor.apply(this, arguments); try { addTargetBox(); } catch (e) { console.error(e); } };
  async function iconFromDataUrl(a, url) {
    if (!url) return;
    try { const r = await blobToIcon(await (await fetch(url)).blob()); a.iconData = r.data; a.color = r.color; } catch (e) {}
  }
  function addTargetBox() {
    if (edit.kind !== 'app') return;
    const a = appById(edit.id); if (!a || a.launch.method === 'key') return;
    const sum = document.getElementById('sumTxt'); const anchor = sum && sum.closest('.summary'); if (!anchor) return;
    a.targets = a.targets || { win: '', mac: '' };
    const eb = anchor.querySelector('.eyebrow'); if (eb) eb.textContent = 'Uygulama kapalıyken cihaz gönderir';
    if (!cfg.device.kbFallback) anchor.style.display = 'none';   // no keystroke fallback: nothing is ever typed
    document.querySelectorAll('#edBody .hint').forEach(h => {
      if (/Win\+R kutusuna/.test(h.textContent)) h.textContent = 'Örnekler: steam://rungameid/730 (CS2), discord://, spotify:, ms-settings:, explorer, calc, chrome veya "C:\\Program Files\\…\\uygulama.exe" -argüman. Komut arka planda doğrudan çalıştırılır.';
      if (/Başlat'a yazınca/.test(h.textContent)) h.textContent = 'Adı Başlat menüsündeki (Mac\'te Uygulamalar klasöründeki) adıyla yaz; tam eşleşme yoksa adı içeren ilk uygulama açılır. Arama penceresi açılmaz.';
    });
    const box = el('div', { class: 'srcbox', id: 'directBox' }, el('span', { class: 'eyebrow' }, 'Masaüstü uygulamasıyla doğrudan aç'));
    const row = (k, label, ph) => {
      const inp = el('input', { type: 'text', class: 'mono', value: a.targets[k] || '', placeholder: ph, style: 'flex:1;min-width:0', oninput: e => { a.targets[k] = e.target.value.trim(); save(); } });
      const mine = (k === 'win' && OS === 'win32') || (k === 'mac' && OS === 'darwin');
      const pick = mine ? el('button', { class: 'btn sm', onclick: async () => {
        const r = await deck.pickApps(false); if (!r || !r[0]) return;
        a.targets[k] = r[0].path; if (!a.iconData) await iconFromDataUrl(a, r[0].icon); changed(); toast('Doğrudan açılacak: ' + r[0].name);
      } }, 'Seç…') : null;
      const test = mine ? el('button', { class: 'btn sm ghost', onclick: async () => {
        const r = await deck.launch({ app: a.id, name: a.name, method: a.launch.method, value: a.launch.value, path: a.targets.win, mac: a.targets.mac, bg: !!a.bg });
        toast(r.ok ? a.name + ' açıldı' : 'Açılamadı: ' + r.error);
      } }, 'Dene') : null;
      return el('label', { class: 'field' }, el('span', {}, label), el('div', { class: 'row', style: 'flex-wrap:nowrap' }, inp, pick, test));
    };
    box.append(
      row('win', 'Windows: program (.exe), kısayol (.lnk / .url) veya adres', 'C:\\Program Files\\…\\uygulama.exe'),
      row('mac', 'macOS: uygulama', '/Applications/Spotify.app'),
      el('label', { class: 'row', style: 'cursor:pointer;flex-wrap:nowrap;align-items:flex-start;gap:8px' }, el('input', { type: 'checkbox', id: 'appBg', checked: !!a.bg, onchange: e => { a.bg = e.target.checked; save(); } }), 'Arka planda aç (odağı alma: Windows\'ta simge durumunda, macOS\'ta arkada açılır)'),
      el('p', { class: 'hint' }, 'Uygulama sistem çağrısıyla doğrudan başlatılır; Çalıştır kutusu, Başlat araması ya da Spotlight hiç açılmaz. Boş bırakırsan yukarıdaki komut ya da ad kullanılır: Windows\'ta Başlat menüsü kaydından (arama penceresi açılmadan), macOS\'ta uygulama adından bulunur.')
    );
    anchor.after(box);
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
      for (const f of arr) { const p = deck.pathForFile(f); if (/\.app\/?$/i.test(p)) apps.push(p.replace(/\/$/, '')); else rest.push(f); }
      if (apps.length) await addMacApps(await Promise.all(apps.map(p => deck.appInfo(p))));
      if (rest.length) return _import(rest);
    };
    const hint = b && b.closest('div') && [...document.querySelectorAll('.hint, p')].find(x => /\.exe, kısayol/.test(x.textContent));
    if (hint) hint.textContent = 'Uygulamalar klasöründen bir veya birkaç uygulama seç ya da Finder\'dan buraya sürükle. İkon ve ad kendiliğinden gelir.';
  }

  // the deck's fallback style follows this computer
  if (cfg.device && cfg.device.host !== HOST) { cfg.device.host = HOST; save(); }
  deck.version().then(v => { const t = document.querySelector('.brand small, #brandSub'); if (t) t.textContent = 'Masaüstü v' + v; }).catch(() => {});
})();
