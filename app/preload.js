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
  hostState: o => ipcRenderer.invoke('host-state', o),
  mediaControl: (action, target) => ipcRenderer.invoke('media-ctl', action, target),
  sysSet: o => ipcRenderer.invoke('sys-set', o),
  pathForFile: f => { try { return webUtils.getPathForFile(f) || ''; } catch (e) { return ''; } }
});
