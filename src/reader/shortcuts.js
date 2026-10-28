import config from '../../reader-shortcuts.json';
export const shortcutActions = config.bindings;
export const defaultShortcuts = Object.fromEntries(config.bindings.map(item => [item.id, item.key]));
export function eventShortcut(event) {
  let key = event.code || event.key || '';
  if (/^Key[A-Z]$/.test(key)) key = key.slice(3);
  else if (/^Digit[0-9]$/.test(key)) key = key.slice(5);
  else if (/^[a-z0-9]$/i.test(key)) key = key.toUpperCase();
  else if (key === ' ') key = 'Space';
  else if (key === ',') key = 'Comma';
  if (!config.keys.includes(key) && !/^[A-Z0-9]$/.test(key)) return '';
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
}
export const reservedShortcut = key => config.reserved.includes(key);
export function shortcutLabel(key = '') {
  const labels = {ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: '空格', Comma: ',', Period: '.', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Slash: '/', Backslash: '\\', Backquote: '`', Meta: 'Win'};
  return key.split('+').map(part => labels[part] || part).join(' + ');
}
