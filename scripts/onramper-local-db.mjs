import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = join(tmpdir(), 'onramper-local-postgres');
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});
await mkdir(runtime, { recursive: true, mode: 0o700 });
const entry = join(runtime, 'node_modules/embedded-postgres/dist/index.js');
try { await access(entry); } catch {
  await run('npm', ['--cache', join(runtime, 'npm-cache'), 'install', '--prefix', runtime, '--no-save', '--ignore-scripts', 'embedded-postgres@18.4.0-beta.17']);
  const packagePath = join(runtime, `node_modules/@embedded-postgres/${process.platform}-${process.arch}/scripts/hydrate-symlinks.js`);
  await run(process.execPath, [packagePath]);
}
const { default: EmbeddedPostgres } = await import(pathToFileURL(entry).href);
const pg = new EmbeddedPostgres({
  databaseDir: join(runtime, 'data'), user: 'onramper', password: 'local-test-only', port: 55439,
  persistent: true, postgresFlags: ['-h', '127.0.0.1'], createPostgresUser: false,
  onLog: () => {}, onError: console.error,
});
try { await access(join(runtime, 'data/PG_VERSION')); } catch { await pg.initialise(); }
await pg.start();
for (const name of ['onramper_local', 'onramper_authorization_test']) {
  const client = pg.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  const { rows } = await client.query('SELECT datname FROM pg_database WHERE datname=$1', [name]);
  if (!rows.length) await pg.createDatabase(name);
  await client.end();
}
console.log('Local PostgreSQL ready on 127.0.0.1:55439 (onramper_local and onramper_authorization_test). Stop with Ctrl+C.');
setInterval(() => {}, 10000);
const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
