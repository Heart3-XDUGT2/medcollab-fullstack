import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function prepareWritableDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.medcollab-write-check-${randomUUID()}`);
  fs.writeFileSync(probe, '', { flag: 'wx' });
  fs.unlinkSync(probe);
}

function asciiAbsoluteDirectory(value) {
  return typeof value === 'string' &&
    /^[\x20-\x7e]+$/.test(value) &&
    path.win32.isAbsolute(value);
}

export function javaBuildEnvironment(baseEnv, {
  platform = process.platform,
  systemEnv = process.env,
  systemTemp = os.tmpdir(),
  prepareDirectory = prepareWritableDirectory,
} = {}) {
  if (platform !== 'win32') return baseEnv;

  const override = systemEnv.MEDCOLLAB_JAVA_TMPDIR?.trim();
  let temporary;
  if (override) {
    if (!asciiAbsoluteDirectory(override)) {
      throw new Error('MEDCOLLAB_JAVA_TMPDIR must be an absolute ASCII directory on Windows.');
    }
    temporary = path.win32.normalize(override);
    try {
      prepareDirectory(temporary);
    } catch (cause) {
      throw new Error('MEDCOLLAB_JAVA_TMPDIR is not writable; choose a writable ASCII directory.', { cause });
    }
  } else {
    const candidates = [
      systemTemp,
      systemEnv.TEMP,
      systemEnv.TMP,
      systemEnv.TMPDIR,
      systemEnv.LOCALAPPDATA ? path.win32.join(systemEnv.LOCALAPPDATA, 'Temp') : null,
    ];
    const seen = new Set();
    for (const base of candidates) {
      if (!asciiAbsoluteDirectory(base)) continue;
      const directory = path.win32.join(base, 'medcollab-java-tests');
      const key = directory.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        prepareDirectory(directory);
        temporary = directory;
        break;
      } catch {
        // Try another system temp location, never the Unicode repository path.
      }
    }
    if (!temporary) {
      throw new Error('No writable ASCII Windows Java temporary directory was found. Set MEDCOLLAB_JAVA_TMPDIR to an absolute, writable ASCII directory.');
    }
  }
  return { ...baseEnv, TEMP: temporary, TMP: temporary, TMPDIR: temporary };
}
