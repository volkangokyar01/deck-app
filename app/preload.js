const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('deck', {
  platform: process.platform,
  launch: e => ipcRenderer.invoke('launch', e),
  pickApps: multi => ipcRenderer.invoke('pick-apps', multi),
  appInfo: p => ipcRenderer.invoke('app-info', p),
  readTemps: o => ipcRenderer.invoke('read-temps', o),
  notify: (t, b) => ipcRenderer.invoke('notify', t, b),
  status: s => ipcRenderer.send('status', s),
  version: () => ipcRenderer.invoke('version'),
  pathForFile: f => { try { return webUtils.getPathForFile(f) || ''; } catch (e) { return ''; } }
});
