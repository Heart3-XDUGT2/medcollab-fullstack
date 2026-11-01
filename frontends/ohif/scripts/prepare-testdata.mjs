import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// This source distribution is nested in a combined repository and has no Git
// submodule entry. Download the optional upstream fixtures only on explicit use.
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../testdata');
if (existsSync(target) && readdirSync(target).length > 0) {
  console.log('testdata already exists; preserving it without fetching or replacing files.');
} else {
  const result = spawnSync('git', [
    'clone', '--depth', '1', '--branch', 'main',
    'https://github.com/OHIF/viewer-testdata-dicomweb.git', target,
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
