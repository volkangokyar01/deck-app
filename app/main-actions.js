function openLocationSettings(platform, shell) {
  const url = { darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
    win32: 'ms-settings:privacy-location' }[platform];
  return url ? shell.openExternal(url) : Promise.reject(new Error('Bu sistem desteklenmiyor'));
}
function createTrayUpdate({ updater, dialog, refreshTray }) {
  let working = false;
  return async function trayUpdate() {
    if (working) return;
    working = true;
    const message = text => dialog.showMessageBox({ type: 'info', title: 'Game Deck', message: text, buttons: ['Tamam'] });
    try {
      let state = updater.getState();
      if (['checking', 'downloading', 'installing'].includes(state.phase)) return;
      if (!state.available) state = await updater.check({ manual: true });
      refreshTray();
      if (state.needsInstaller || !state.available || state.phase === 'error') { await message(state.message); return; }
      const { response } = await dialog.showMessageBox({ type: 'question', title: 'Game Deck',
        message: 'Game Deck güncellensin mi? Uygulama yeniden başlar.',
        buttons: ['Güncelle', 'Vazgeç'], defaultId: 0, cancelId: 1, noLink: true });
      if (response === 0) {
        const result = await updater.apply();
        if (result?.phase === 'error' || result?.needsInstaller) await message(result.message);
      }
    } catch (e) { await message('Güncelleme yapılamadı: ' + e.message); }
    finally { working = false; refreshTray(); }
  };
}
module.exports = { createTrayUpdate, openLocationSettings };
