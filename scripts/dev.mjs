import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({root});
await server.listen();
server.printUrls();
const environment = {...process.env, MOYU_DEV_SERVER_URL: 'http://127.0.0.1:5173/'};
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [root], {cwd: root, stdio: 'inherit', env: environment});
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  if (child.exitCode === null) child.kill();
  await server.close();
  process.exitCode = code;
}
child.once('exit', code => void close(code ?? 0));
child.once('error', error => { console.error(error); void close(1); });
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
