import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, unlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const commands = {
  integration: 'node --test test/llm-integration.test.js test/firebase-sync-integration.test.js',
  all: 'node --test test/llm-integration.test.js test/firebase-sync-integration.test.js && npm run test:browser'
};
const mode = process.argv[2];
if (mode !== 'start' && !Object.hasOwn(commands, mode)) {
  throw new Error('Expected emulator mode start, integration, or all.');
}

const host = '127.0.0.1';
const project = 'demo-voice-shopping';
const config = JSON.parse(await readFile(join(root, 'firebase.json'), 'utf8'));
config.emulators = {
  auth: { host, port: 9099 },
  firestore: { host, port: 8080, websocketPort: 9150 },
  functions: { host, port: 5001 },
  hosting: { host, port: 5055 },
  ui: { enabled: false }
};
const csp = config.hosting.headers.flatMap(entry => entry.headers)
  .find(header => header.key === 'Content-Security-Policy');
csp.value = csp.value.replace(/(connect-src [^;]+)/, '$1 http://127.0.0.1:9099 http://127.0.0.1:8080 http://localhost:9099 http://localhost:8080');

const configDir = await mkdtemp(join(tmpdir(), 'voice-shopping-firebase-'));
const configPath = join(root, `.firebase-emulator-${process.pid}.json`);
const emulatorsPath = process.env.FIREBASE_EMULATORS_PATH || join(root, 'node_modules/.cache/firebase/emulators');
await mkdir(emulatorsPath, { recursive: true });
await writeFile(configPath, JSON.stringify(config), { flag: 'wx' });
try {
  const args = [
    join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'),
    mode === 'start' ? 'emulators:start' : 'emulators:exec',
    '--config', configPath, '--project', project, '--only', 'auth,firestore,functions,hosting',
    ...(mode === 'start' ? [] : [commands[mode]])
  ];
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      XDG_CONFIG_HOME: configDir,
      FIREBASE_EMULATORS_PATH: emulatorsPath,
      CI: 'true',
      SHOPPING_DEMO_INTEGRATION: '1'
    }
  });
  const stop = signal => child.kill(signal);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)));
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
} finally {
  await unlink(configPath);
  await rm(configDir, { recursive: true, force: true });
}
