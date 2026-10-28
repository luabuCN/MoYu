'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('moyu', Object.freeze({
  getState: async () => ({panel: 'reader', theme: 'light'}),
  action: async () => ({ok: true, result: {}}),
  reader: (name, value) => ipcRenderer.invoke('moyu:test-reader-verification', name, value),
  onState: () => () => {},
  onFocusAddress: () => () => {},
}));
