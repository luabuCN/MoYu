'use strict';
const config = require('./reader-shortcuts.json');
const defaults = Object.fromEntries(config.bindings.map(item => [item.id, item.key]));
function validShortcut(value) {
  if (typeof value !== 'string' || value.length > 48 || config.reserved.includes(value)) return false;
  const parts = value.split('+'), key = parts.pop();
  return (config.keys.includes(key) || /^[A-Z0-9]$/.test(key))
    && parts.every(modifier => config.modifiers.includes(modifier))
    && parts.join('+') === config.modifiers.filter(modifier => parts.includes(modifier)).join('+');
}
function normalizeShortcuts(value = {}, old = defaults) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('快捷键设置无效');
  const result = Object.fromEntries(config.bindings.map(item => [item.id, value[item.id] ?? old[item.id] ?? item.key]));
  const used = new Set();
  for (const item of config.bindings) {
    const key = result[item.id];
    if (!validShortcut(key)) throw new Error(`“${item.label}”使用了保留或无效的快捷键`);
    if (item.id === 'toggleTransparent' && !/^(?:Ctrl|Alt|Meta)\+|\+(?:Ctrl|Alt|Meta)\+|^F\d+$/.test(key)) throw new Error('透明切换请使用 Ctrl、Alt、Win 组合键或功能键');
    if (used.has(key)) throw new Error('快捷键重复，请为不同操作设置不同按键');
    used.add(key);
  }
  return result;
}
function shortcutAccelerator(value) {
  if (!validShortcut(value)) throw new Error('快捷键无效');
  const names = {Ctrl: 'Control', Meta: 'Super', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Comma: ',', Period: '.', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Slash: '/', Backslash: '\\', Backquote: '`'};
  return value.split('+').map(part => names[part] || part).join('+');
}
module.exports = {defaultShortcuts: defaults, normalizeShortcuts, shortcutAccelerator};
