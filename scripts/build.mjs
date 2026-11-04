import path from 'node:path';
import fs from 'node:fs';
import { root, backend, windows, run } from './common.mjs';
import { javaBuildEnvironment } from './java-build-env.mjs';

const target = process.argv[2] || 'all';
if (!['all', 'portal', 'ohif', 'backend'].includes(target)) throw new Error('Usage: node scripts/build.mjs [all|portal|ohif|backend]');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
const temporary = path.join(root, '.runtime', 'tmp');
fs.mkdirSync(temporary, { recursive: true });
const buildEnv = {
  ...process.env,
  npm_config_cache: path.join(root, '.runtime', 'npm-cache'),
  MAVEN_USER_HOME: path.join(root, '.runtime', 'maven'),
  TEMP: temporary, TMP: temporary, TMPDIR: temporary,
};
for (const name of ['portal', 'ohif']) {
  if (target !== 'all' && target !== name) continue;
  const cwd = path.join(root, 'frontends', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager)) throw new Error('Expected an exact pnpm version in package.json.');
  const npx = windows ? 'npx.cmd' : 'npx';
  const prefix = ['--yes', pkg.packageManager];
  run(npx, [...prefix, 'install', '--frozen-lockfile', '--store-dir=../../.runtime/pnpm-store'], { cwd, env: buildEnv });
  run(npx, [...prefix, 'run', 'build'], {
    cwd,
    env: name === 'ohif' ? { ...buildEnv, APP_CONFIG: 'config/medcollab-server.js', PUBLIC_URL: '/imaging/' } : buildEnv,
  });
}
if (target === 'all' || target === 'backend') {
  const javaEnv = javaBuildEnvironment(buildEnv);
  const args = ['-B', '-Dmaven.repo.local=../.runtime/maven/repository', 'package'];
  if (windows) run(path.join(backend, 'mvnw.cmd'), args, { cwd: backend, env: javaEnv });
  else run('sh', ['./mvnw', ...args], { cwd: backend, env: javaEnv });
}
