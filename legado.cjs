'use strict';
const path = require('node:path');
const {Worker} = require('node:worker_threads');

function runLegado(source, operation, params = {}, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(Object.assign(new Error('搜索已取消'), {code: 'canceled'})); return; }
    const worker = new Worker(path.join(__dirname, 'legado-worker.cjs'), {workerData: {source, operation, params, state: options.state || {}, cpuMs: options.cpuMs || 5000}, resourceLimits: {maxOldGenerationSizeMb: 192, stackSizeMb: 4}});
    let settled = false, requests = 0, lastNetworkError;
    const finish = (error, result) => {
      if (settled) return; settled = true;
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      void worker.terminate(); error ? reject(error) : resolve(result);
    };
    const abort = () => finish(Object.assign(new Error('搜索已取消'), {code: 'canceled'}));
    const timer = setTimeout(() => finish(Object.assign(new Error('书源脚本运行超时'), {code: 'script-timeout'})), options.timeoutMs || 90000);
    options.signal?.addEventListener('abort', abort, {once: true});
    worker.on('error', error => finish(error));
    worker.on('exit', code => { if (!settled) finish(new Error(`书源运行进程意外退出（${code}）`)); });
    worker.on('message', async message => {
      if (settled) return;
      if (message.type === 'call') {
        try {
          if (++requests > 256) throw new Error('单次操作的书源请求过多');
          const value = await options.call(message.value);
          if (!settled) worker.postMessage({id: message.id, value});
        } catch (error) {
          lastNetworkError = error;
          if (!settled) worker.postMessage({id: message.id, error: {message: error.message, code: error.code, status: error.status, url: error.url}});
        }
      } else if (message.type === 'result') {
        if (lastNetworkError && operation === 'search' && !message.result.value?.length) { finish(lastNetworkError); return; }
        finish(null, message.result);
      } else if (message.type === 'error') finish(Object.assign(new Error(message.error.message), {code: message.error.code || 'script'}));
    });
  });
}
module.exports = {runLegado};
