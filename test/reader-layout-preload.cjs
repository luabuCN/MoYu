'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('moyu', Object.freeze({
  getState: async () => ({panel: 'reader', theme: 'light'}),
  action: async () => ({ok: true, result: {}}),
  reader: (name, value) => ipcRenderer.invoke('moyu:test-reader-layout', name, value),
  onState: () => () => {}, onFocusAddress: () => () => {},
  onReaderRecovery: callback => {
    const listener = () => callback(); ipcRenderer.on('moyu:reader-recover', listener);
    return () => ipcRenderer.removeListener('moyu:reader-recover', listener);
  },
}));
