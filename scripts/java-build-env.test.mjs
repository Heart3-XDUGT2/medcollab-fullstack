import { test } from 'node:test';
import assert from 'node:assert/strict';
import { javaBuildEnvironment } from './java-build-env.mjs';

const baseEnv = Object.freeze({
  TEMP: 'C:\\项目\\.runtime\\tmp',
  TMP: 'C:\\项目\\.runtime\\tmp',
  TMPDIR: 'C:\\项目\\.runtime\\tmp',
  npm_config_cache: 'C:\\项目\\.runtime\\npm-cache',
  MAVEN_USER_HOME: 'C:\\项目\\.runtime\\maven',
  JAVA_TOOL_OPTIONS: '-Xmx256m',
});

test('Windows uses a named writable ASCII system temp directory only for its environment copy', () => {
  const prepared = [];
  const result = javaBuildEnvironment(baseEnv, {
    platform: 'win32', systemEnv: {}, systemTemp: 'C:\\Users\\Research User\\Temp',
    prepareDirectory: directory => prepared.push(directory),
  });
  assert.deepEqual(prepared, ['C:\\Users\\Research User\\Temp\\medcollab-java-tests']);
  for (const key of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(result[key], prepared[0]);
  assert.equal(result.npm_config_cache, baseEnv.npm_config_cache);
  assert.equal(result.MAVEN_USER_HOME, baseEnv.MAVEN_USER_HOME);
  assert.equal(result.JAVA_TOOL_OPTIONS, baseEnv.JAVA_TOOL_OPTIONS);
  assert.equal(baseEnv.TEMP, 'C:\\项目\\.runtime\\tmp');
});

test('a non-ASCII primary temp falls back to an ASCII system temp candidate', () => {
  const result = javaBuildEnvironment(baseEnv, {
    platform: 'win32', systemTemp: 'C:\\用户\\Temp',
    systemEnv: { TEMP: 'C:\\用户\\Temp', TMP: 'C:\\Temp' },
    prepareDirectory: () => {},
  });
  assert.equal(result.TEMP, 'C:\\Temp\\medcollab-java-tests');
});

test('LOCALAPPDATA Temp is a fallback when the configured temp paths are non-ASCII', () => {
  const result = javaBuildEnvironment(baseEnv, {
    platform: 'win32', systemTemp: 'C:\\用户\\Temp',
    systemEnv: { TEMP: 'C:\\项目\\Temp', LOCALAPPDATA: 'C:\\Users\\Research\\AppData\\Local' },
    prepareDirectory: () => {},
  });
  assert.equal(result.TEMP, 'C:\\Users\\Research\\AppData\\Local\\Temp\\medcollab-java-tests');
});

test('an unwritable candidate is skipped and duplicate Windows paths are not retried', () => {
  const prepared = [];
  const result = javaBuildEnvironment(baseEnv, {
    platform: 'win32', systemTemp: 'C:\\Locked',
    systemEnv: { TEMP: 'c:\\locked', TMP: 'D:\\Temp' },
    prepareDirectory: directory => {
      prepared.push(directory);
      if (directory.startsWith('C:')) throw new Error('access denied');
    },
  });
  assert.equal(prepared.length, 2);
  assert.equal(result.TEMP, 'D:\\Temp\\medcollab-java-tests');
});

test('no ASCII candidate fails clearly rather than using the repository temp', () => {
  assert.throws(() => javaBuildEnvironment(baseEnv, {
    platform: 'win32', systemTemp: 'C:\\用户\\Temp',
    systemEnv: { TEMP: 'C:\\项目\\Temp', TMP: 'D:\\临时', LOCALAPPDATA: 'C:\\用户\\Local' },
    prepareDirectory: () => assert.fail('Non-ASCII paths must not be prepared'),
  }), /No writable ASCII.*MEDCOLLAB_JAVA_TMPDIR/);
});

test('all unwritable ASCII candidates fail with the override recovery instruction', () => {
  assert.throws(() => javaBuildEnvironment(baseEnv, {
    platform: 'win32', systemTemp: 'C:\\Locked', systemEnv: {},
    prepareDirectory: () => { throw new Error('access denied'); },
  }), /MEDCOLLAB_JAVA_TMPDIR/);
});

test('an explicit ASCII override is used exactly, without adding the default subdirectory', () => {
  const prepared = [];
  const result = javaBuildEnvironment(baseEnv, {
    platform: 'win32', systemTemp: 'C:\\SystemTemp',
    systemEnv: { MEDCOLLAB_JAVA_TMPDIR: 'D:\\Java Tests\\tmp' },
    prepareDirectory: directory => prepared.push(directory),
  });
  assert.deepEqual(prepared, ['D:\\Java Tests\\tmp']);
  assert.equal(result.TMPDIR, prepared[0]);
});

for (const override of ['C:\\临时\\Java', 'relative-temp', 'C:\\Temp\nInjected']) {
  test(`rejects an invalid Windows override: ${JSON.stringify(override)}`, () => {
    assert.throws(() => javaBuildEnvironment(baseEnv, {
      platform: 'win32', systemTemp: 'C:\\ValidSystemTemp',
      systemEnv: { MEDCOLLAB_JAVA_TMPDIR: override },
      prepareDirectory: () => assert.fail('Invalid overrides must not silently fall back'),
    }), /absolute ASCII directory/);
  });
}

test('an unwritable explicit override fails without silently choosing another location', () => {
  let attempts = 0;
  assert.throws(() => javaBuildEnvironment(baseEnv, {
    platform: 'win32', systemTemp: 'C:\\ValidSystemTemp',
    systemEnv: { MEDCOLLAB_JAVA_TMPDIR: 'D:\\Locked' },
    prepareDirectory: () => { attempts++; throw new Error('access denied'); },
  }), /MEDCOLLAB_JAVA_TMPDIR is not writable/);
  assert.equal(attempts, 1);
});

for (const platform of ['linux', 'darwin']) {
  test(`${platform} preserves the existing build environment and does not prepare a Windows temp`, () => {
    const result = javaBuildEnvironment(baseEnv, {
      platform, systemEnv: { MEDCOLLAB_JAVA_TMPDIR: 'C:\\显式设置' },
      prepareDirectory: () => assert.fail('Windows temp selection must not run'),
    });
    assert.equal(result, baseEnv);
  });
}
