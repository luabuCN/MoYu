'use strict';
const {contextBridge, ipcRenderer} = require('electron');

// Only the local application shell gets a preload. Remote pages have no bridge.
contextBridge.exposeInMainWorld('moyu', Object.freeze({
  getState: () => ipcRenderer.invoke('moyu:state'),
  action: (name, value) => ipcRenderer.invoke('moyu:action', name, value),
  reader: (name, value) => ipcRenderer.invoke('moyu:reader', name, value),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('moyu:state', listener);
    return () => ipcRenderer.removeListener('moyu:state', listener);
  },
  onFocusAddress: callback => {
    const listener = () => callback();
    ipcRenderer.on('moyu:focus-address', listener);
    return () => ipcRenderer.removeListener('moyu:focus-address', listener);
  },
  onReaderRecovery: callback => {
    const listener = () => callback();
    ipcRenderer.on('moyu:reader-recover', listener);
    return () => ipcRenderer.removeListener('moyu:reader-recover', listener);
  },
}));
