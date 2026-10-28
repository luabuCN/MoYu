// Imported patterns run in a disposable worker; a pathological expression cannot block the UI.
self.onmessage = ({data}) => {
  try {
    const result = data.map(({text, rules}) => {
      let value = String(text || '');
      for (const rule of rules) {
        const pattern = new RegExp(rule.pattern, 'g');
        if (rule.first) value = value.match(pattern)?.[0] || '';
        value = value.replace(pattern, rule.replacement || '');
        if (value.length > 1000000) throw new Error('文本替换结果过大');
      }
      return value.trim();
    });
    self.postMessage({result});
  } catch (error) { self.postMessage({error: `书源正则规则无效：${error.message}`}); }
};
