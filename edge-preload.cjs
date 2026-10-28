'use strict';
const {ipcRenderer} = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  document.querySelector('button').addEventListener('click', () => ipcRenderer.send('moyu:restore'));
});
