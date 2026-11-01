import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const backend = path.join(root, 'backend');
export const windows = process.platform === 'win32';

export function run(program, args, { cwd = root, env = process.env } = {}) {
  const batch = windows && /\.(cmd|bat)$/i.test(program);
  let executable = program;
  if (batch && !path.isAbsolute(program)) {
    const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
    executable = searchPath.split(path.delimiter).map(folder => path.join(folder.replaceAll('"', ''), program))
      .find(candidate => fs.existsSync(candidate));
    if (!executable) throw new Error(`${program} is not installed or not on PATH.`);
  }
  // Only fixed build arguments reach a Windows batch wrapper; reject shell syntax.
  if (batch && args.some(arg => !/^[a-zA-Z0-9@._/:=-]+$/.test(arg))) throw new Error('Unsafe batch argument.');
  const result = spawnSync(batch ? `"${executable}" ${args.join(' ')}` : executable, batch ? [] : args, {
    cwd, env, stdio: 'inherit', shell: batch, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(program)} failed (${result.status ?? result.signal}).`);
}

export function localEnvironment() {
  const file = path.join(root, 'deploy', '.env');
  if (!fs.existsSync(file)) throw new Error('Run node scripts/setup.mjs first.');
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error('Invalid deploy/.env line; use KEY=value without shell syntax.');
    values[match[1]] = match[2];
  }
  return { ...process.env, ...values };
}
