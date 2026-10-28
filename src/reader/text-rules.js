export function transformTexts(jobs) {
  if (!jobs.some(job => job.rules.length)) return Promise.resolve(jobs.map(job => job.text));
  return new Promise((resolve, reject) => {
    const worker = new TextRuleWorker();
    const finish = (error, result) => { clearTimeout(timer); worker.terminate(); error ? reject(new Error(error)) : resolve(result); };
    const timer = setTimeout(() => finish('书源文本处理超时，请检查正则替换规则'), 1500);
    worker.onmessage = ({data}) => finish(data.error, data.result);
    worker.onerror = () => finish('书源文本处理失败');
    worker.postMessage(jobs);
  });
}

export function splitRule(rule) {
  if (typeof rule !== 'string') return {selector: rule, rules: rule?.handler?.replace ? [{pattern: String(rule.handler.replace), replacement: rule.handler.replaceValue || ''}] : []};
  const [selector, pattern, replacement = '', first = ''] = rule.split('##');
  return {selector, rules: pattern ? [{pattern, replacement, first: first === '1'}] : []};
}
import TextRuleWorker from './text-rules.worker.js?worker&inline';
