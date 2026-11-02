import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
const root = path.dirname(fileURLToPath(import.meta.url));
const login = path.join(root, 'medcollab-portal/login');
const read = name => fs.readFile(path.join(login, name), 'utf8');
const repository = path.resolve(root, '../..');
const byteStablePaths = [
  'frontends/portal/src/styles.css',
  'frontends/portal/src/ui/ui.css',
  'frontends/portal/src/features/sign-in/sign-in.css',
  'frontends/portal/public/brand/medcollab-mark.svg',
  'gateway/theme/medcollab-portal/login/resources/css/styles.css',
  'gateway/theme/medcollab-portal/login/resources/css/ui.css',
  'gateway/theme/medcollab-portal/login/resources/css/sign-in.css',
  'gateway/theme/medcollab-portal/login/resources/brand/medcollab-mark.svg',
  'gateway/theme/medcollab-portal/style-provenance.json',
];
test('hash-participating text has explicit LF checkout policy and no CR bytes', async () => {
  for (const filename of byteStablePaths) {
    const attributes = execFileSync('git', ['-C', repository, 'check-attr', 'text', 'eol', '--', filename], { encoding: 'utf8' });
    // Portal already has a child attribute file using text=auto with eol=lf.
    assert.match(attributes, /: text: (set|auto)/);
    assert.match(attributes, /: eol: lf/);
    assert.equal((await fs.readFile(path.join(repository, filename))).includes(13), false, filename);
  }
});
test('strict source bytes survive Git clean/checkout filters with autocrlf true and false', async () => {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const temporary = await fs.mkdtemp(path.join(temporaryRoot, 'medcollab-theme-eol-'));
  try {
    execFileSync('git', ['init', '-q', temporary]);
    await fs.copyFile(path.join(repository, '.gitattributes'), path.join(temporary, '.gitattributes'));
    await fs.mkdir(path.join(temporary, 'frontends/portal'), { recursive: true });
    await fs.copyFile(path.join(repository, 'frontends/portal/.gitattributes'), path.join(temporary, 'frontends/portal/.gitattributes'));
    for (const mode of ['true', 'false']) {
      for (const filename of byteStablePaths) {
        const original = await fs.readFile(path.join(repository, filename));
        const crlf = original.toString('utf8').replaceAll('\n', '\r\n');
        const args = ['-C', temporary, '-c', `core.autocrlf=${mode}`, '-c', 'core.safecrlf=false'];
        const blob = execFileSync('git', [...args, 'hash-object', '-w', `--path=${filename}`, '--stdin'], { input: crlf, encoding: 'utf8' }).trim();
        const checkedOut = execFileSync('git', [...args, 'cat-file', '--filters', `--path=${filename}`, blob]);
        assert.deepEqual(checkedOut, original, `${mode}: ${filename}`);
      }
    }
  } finally {
    const resolved = await fs.realpath(temporary);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith('medcollab-theme-eol-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
test('login preserves server action, credential selection and sanitized server errors', async () => {
  const text = await read('login.ftl');
  assert.match(text, /action="\$\{url\.loginAction\}" method="post"/);
  for (const name of ['username', 'password', 'credentialId', 'rememberMe']) assert.match(text, new RegExp(`name="${name}"`));
  assert.match(text, /auth\.selectedCredential/);
  assert.match(text, /messagesPerField\.existsError\('username'\)/);
  assert.match(text, /messagesPerField\.existsError\('password'\)/);
  assert.match(text, /kcSanitize\(message\.summary\)/);
  assert.match(text, /url\.loginResetCredentialsUrl/);
  assert.match(text, /url\.registrationUrl/);
});
test('registration retains Keycloak profile attributes and server validation', async () => {
  const text = await read('register.ftl');
  assert.match(text, /action="\$\{url\.registrationAction\}" method="post"/);
  assert.match(text, /userProfileCommons\.userProfileFormFields/);
  assert.match(text, /'password', 'password-confirm'/);
  assert.match(text, /messagesPerField\.get\(field\)/);
  assert.match(text, /url\.loginUrl/);
});
test('reset form delegates to the server and retains username errors', async () => {
  const text = await read('login-reset-password.ftl');
  assert.match(text, /action="\$\{url\.loginAction\}" method="post"/);
  assert.match(text, /name="username"/);
  assert.match(text, /auth\.attemptedUsername/);
  assert.match(text, /kcSanitize\(messagesPerField\.get\('username'\)\)/);
});
test('theme layout is isolated from Portal account classes and uses shared mark', async () => {
  const text = await read('template.ftl');
  assert.match(text, /class="mc-kc"/);
  assert.match(text, /resourcesPath\}\/brand\/medcollab-mark\.svg/);
  assert.match(text, /resourcesPath\}\/css\/auth\.css/);
  assert.doesNotMatch(text, /class="mc-auth/);
  assert.match(text, /kcSanitize\(message\.summary\)/);
});
test('generated shared styles and mark match source hashes; licenses remain present', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'medcollab-portal/style-provenance.json'), 'utf8'));
  const portal = path.resolve(root, '../../frontends/portal');
  for (const file of manifest.files) {
    const source = await fs.readFile(path.join(portal, file.source));
    assert.equal(createHash('sha256').update(source).digest('hex'), file.sha256);
    const output = file.destination.startsWith('brand/') ? file.destination : `css/${file.destination}`;
    assert.deepEqual(await fs.readFile(path.join(login, 'resources', output)), source);
  }
  for (const file of ['PORTAL-LICENSE', 'inter-OFL.txt', 'lucide-LICENSE.txt']) {
    assert.ok((await fs.readFile(path.join(root, 'medcollab-portal', file))).length > 0);
  }
});
test('fixture cannot submit credentials; auth script does not fetch/store/log them', async () => {
  for (const name of ['login', 'register', 'reset']) {
    const text = await fs.readFile(path.join(root, `fixtures/${name}.html`), 'utf8');
    assert.match(text, /隔离主题样式验证/);
    assert.match(text, /readonly/);
    assert.doesNotMatch(text, /type="submit"|action=|method="post"/);
  }
  const js = await read('resources/js/portal-auth.js');
  assert.doesNotMatch(js, /fetch\(|localStorage|sessionStorage|console\./);
});
