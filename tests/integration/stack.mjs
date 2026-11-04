import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

export const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const PROJECT = 'medcollab-work-home-integration';
export const REALM = 'medcollab-integration';
export const URLS = Object.freeze({
  portal: 'http://127.0.0.1:18080', java: 'http://127.0.0.1:18082',
  keycloak: 'http://127.0.0.1:18081', orthanc: 'http://127.0.0.1:18042',
});
const OWNER = 'org.medcollab.integration.owner';
const DEFAULT_RUNTIME = path.join(REPO, '.runtime', 'integration', 'work-home-live');
const secret = () => randomBytes(24).toString('hex');
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
export function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
export function validateRuntime(repo, runtime) {
  const base = path.join(repo, '.runtime', 'integration');
  if (!path.isAbsolute(runtime) || !inside(base, runtime)) throw new Error('Runtime must be an absolute child of .runtime/integration.');
  let current = repo;
  for (const part of path.relative(repo, runtime).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Runtime junctions/symlinks are not allowed.');
  }
  return path.resolve(runtime);
}
function noRuntimeLinks(runtime, target) {
  if (!inside(runtime, target)) throw new Error('Runtime artifact is outside its owner directory.');
  let current = runtime;
  for (const part of path.relative(runtime, target).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error('Runtime artifact junctions/symlinks are not allowed.');
  }
}
function sourceRoot(value) {
  if (!value || !path.isAbsolute(value)) throw new Error('An absolute isolated --source-root is required.');
  const source = fs.realpathSync(value), original = fs.realpathSync(REPO);
  if (same(source, original) || !fs.existsSync(path.join(source, 'backend', 'pom.xml')))
    throw new Error('Source must be an independent tree containing backend/pom.xml, not the original checkout.');
  return source;
}
function fileWithin(source, relative) {
  const filename = fs.realpathSync(path.join(source, relative));
  if (!inside(source, filename)) throw new Error('Build artifact resolves outside the isolated source tree.');
  return filename;
}
function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch { throw new Error('Cannot read valid private runtime file: ' + path.basename(filename)); }
}
function writeJson(filename, value) {
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
function raw(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw new Error(path.basename(program) + ' could not run; subprocess diagnostics withheld.');
  return result;
}
function command(program, args, options = {}) {
  const result = raw(program, args, options);
  if (result.status !== 0) throw new Error(path.basename(program) + ' failed; subprocess diagnostics withheld to protect credentials.');
  return result.stdout.trim();
}
export function makeManifest(runtime, source, images) {
  return {
    schemaVersion: 1, projectName: PROJECT, ownerId: randomUUID(), runtimeRoot: runtime, sourceRoot: source,
    urls: { ...URLS }, realm: REALM, issuer: URLS.keycloak + '/realms/' + REALM,
    clientId: 'medcollab-integration-web', directoryClientId: 'medcollab-integration-directory', images,
    users: {
      a: { username: 'integration-a', subject: randomUUID() },
      b: { username: 'integration-b', subject: randomUUID() },
    },
    paths: {
      credentials: path.join(runtime, 'credentials.json'), compose: path.join(runtime, 'compose.json'),
      realm: path.join(runtime, 'realm.json'), orthanc: path.join(runtime, 'orthanc.json'),
      composeEnv: path.join(runtime, 'empty-compose.env'),
      dicomManifest: path.join(runtime, 'dicom', 'manifest.json'),
    },
    dicomFiles: [1, 2].map(n => path.join(runtime, 'dicom', `synthetic-ct-${String(n).padStart(3, '0')}.dcm`)),
  };
}
export function makeCredentials(m) {
  return {
    keycloakAdmin: { username: 'integration-admin', password: secret() },
    clients: { webSecret: secret(), directorySecret: secret() },
    users: {
      a: { username: m.users.a.username, password: secret() },
      b: { username: m.users.b.username, password: secret() },
    },
  };
}
export function makeRealm(m, c) {
  return {
    realm: REALM, enabled: true, registrationAllowed: false, sslRequired: 'none',
    loginWithEmailAllowed: false, resetPasswordAllowed: false,
    clients: [
      {
        clientId: m.clientId, enabled: true, protocol: 'openid-connect', publicClient: false,
        clientAuthenticatorType: 'client-secret', secret: c.clients.webSecret,
        standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false,
        redirectUris: [URLS.portal + '/login/oauth2/code/keycloak'], webOrigins: [URLS.portal],
        defaultClientScopes: ['web-origins', 'acr', 'profile', 'roles', 'email'],
        attributes: { 'post.logout.redirect.uris': URLS.portal + '/*', 'pkce.code.challenge.method': 'S256' },
      },
      {
        clientId: m.directoryClientId, enabled: true, protocol: 'openid-connect', publicClient: false,
        clientAuthenticatorType: 'client-secret', secret: c.clients.directorySecret,
        standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true, fullScopeAllowed: false, defaultClientScopes: ['roles'],
      },
    ],
    clientScopeMappings: { 'realm-management': [{ client: m.directoryClientId, roles: ['view-users', 'query-users'] }] },
    users: [
      ...['a', 'b'].map(key => ({
        id: m.users[key].subject, username: m.users[key].username, enabled: true,
        firstName: 'Synthetic', lastName: key.toUpperCase(), email: `integration-${key}@example.invalid`,
        emailVerified: true, requiredActions: [],
        credentials: [{ type: 'password', value: c.users[key].password, temporary: false }],
      })),
      {
        username: 'service-account-' + m.directoryClientId, enabled: true, serviceAccountClientId: m.directoryClientId,
        clientRoles: { 'realm-management': ['view-users', 'query-users'] },
      },
    ],
  };
}
export function makeCompose(m, c) {
  const labels = { [OWNER]: m.ownerId };
  return {
    name: PROJECT,
    services: {
      keycloak: {
        image: m.images.keycloak, command: ['start-dev', '--import-realm'], labels,
        environment: {
          KC_BOOTSTRAP_ADMIN_USERNAME: c.keycloakAdmin.username, KC_BOOTSTRAP_ADMIN_PASSWORD: c.keycloakAdmin.password,
          KC_HOSTNAME: URLS.keycloak, KC_HTTP_ENABLED: 'true', KC_HEALTH_ENABLED: 'true',
        },
        ports: ['127.0.0.1:18081:8080'],
        volumes: [
          { type: 'volume', source: 'keycloak-check-data', target: '/opt/keycloak/data' },
          { type: 'bind', source: m.paths.realm, target: '/opt/keycloak/data/import/' + REALM + '-realm.json', read_only: true },
        ],
      },
      orthanc: {
        image: m.images.orthanc, labels, environment: { DICOM_WEB_PLUGIN_ENABLED: 'true' },
        ports: ['127.0.0.1:18042:8042'],
        volumes: [
          { type: 'volume', source: 'orthanc-check-data', target: '/var/lib/orthanc/db' },
          { type: 'bind', source: m.paths.orthanc, target: '/etc/orthanc/integration.json', read_only: true },
        ],
      },
    },
    volumes: { 'keycloak-check-data': { labels }, 'orthanc-check-data': { labels } },
  };
}
function canonicalFile(filename, expected) {
  if (JSON.stringify(readJson(filename)) !== JSON.stringify(expected))
    throw new Error('Runtime file differs from its guarded configuration: ' + path.basename(filename));
}
function validateManifest(m, runtime) {
  if (m.schemaVersion !== 1 || m.projectName !== PROJECT || !same(m.runtimeRoot, runtime) ||
      !/^[0-9a-f-]{36}$/.test(m.ownerId) || JSON.stringify(m.urls) !== JSON.stringify(URLS) ||
      m.realm !== REALM || m.issuer !== URLS.keycloak + '/realms/' + REALM)
    throw new Error('Runtime manifest identity or destinations do not match this integration tool.');
  m.sourceRoot = sourceRoot(m.sourceRoot);
  const expected = makeManifest(runtime, m.sourceRoot, m.images);
  if (JSON.stringify(expected.paths) !== JSON.stringify(m.paths) ||
      JSON.stringify(expected.dicomFiles) !== JSON.stringify(m.dicomFiles) ||
      m.clientId !== expected.clientId || m.directoryClientId !== expected.directoryClientId ||
      !['keycloak', 'orthanc'].every(key => /^sha256:[a-f0-9]{64}$/.test(m.images?.[key])) ||
      !['a', 'b'].every(key => m.users?.[key]?.username === expected.users[key].username && /^[0-9a-f-]{36}$/.test(m.users[key].subject)))
    throw new Error('Runtime manifest paths, images or synthetic users are invalid.');
}
function load(runtime) {
  const m = readJson(path.join(runtime, 'manifest.json'));
  validateManifest(m, runtime);
  for (const target of [
    ...Object.values(m.paths), ...m.dicomFiles,
    ...['java-tmp', 'segmentation', 'java.private.log', 'gateway.private.log', 'java-process.json', 'gateway-process.json'].map(name => path.join(runtime, name)),
  ]) noRuntimeLinks(runtime, target);
  const c = readJson(m.paths.credentials);
  const privateValues = [c.keycloakAdmin?.password, c.clients?.webSecret, c.clients?.directorySecret, c.users?.a?.password, c.users?.b?.password];
  if (privateValues.some(value => typeof value !== 'string' || !/^[a-f0-9]{48}$/.test(value)) ||
      c.keycloakAdmin.username !== 'integration-admin' ||
      !['a', 'b'].every(key => c.users[key].username === m.users[key].username))
    throw new Error('Private integration credentials do not match the preparation.');
  canonicalFile(m.paths.realm, makeRealm(m, c));
  canonicalFile(m.paths.compose, makeCompose(m, c));
  canonicalFile(m.paths.orthanc, orthancConfig());
  if (fs.readFileSync(m.paths.composeEnv, 'utf8') !== '') throw new Error('Compose environment file must remain empty.');
  return { m, c };
}
function orthancConfig() {
  return { Name: 'MedCollab synthetic integration only', RemoteAccessAllowed: true,
    AuthenticationEnabled: false, DicomServerEnabled: false, StorageDirectory: '/var/lib/orthanc/db',
    IndexDirectory: '/var/lib/orthanc/db', DicomWeb: { Enable: true, Root: '/dicom-web/' } };
}
function ownedResources(m) {
  const ids = command('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', '{{.ID}}']).split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const labels = JSON.parse(command('docker', ['inspect', '--format', '{{json .Config.Labels}}', id]));
    if (labels?.[OWNER] !== m.ownerId) throw new Error('Compose project belongs to another preparation; no operation performed.');
  }
  for (const key of ['keycloak-check-data', 'orthanc-check-data']) {
    const name = `${PROJECT}_${key}`;
    const names = command('docker', ['volume', 'ls', '--format', '{{.Name}}', '--filter', 'name=' + name]).split(/\s+/);
    if (names.includes(name) &&
        JSON.parse(command('docker', ['volume', 'inspect', '--format', '{{json .Labels}}', name]))?.[OWNER] !== m.ownerId)
      throw new Error('Existing integration volume has a different owner; refusing attachment.');
  }
}
function imageId(tag) {
  const id = command('docker', ['image', 'inspect', '--format', '{{.Id}}', tag]);
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('Expected an installed image ID; no image will be pulled.');
  return id;
}
function prepare(runtime, args) {
  const source = sourceRoot(args['source-root']);
  if (fs.existsSync(path.join(runtime, 'manifest.json'))) {
    const { m } = load(runtime);
    if (!same(m.sourceRoot, source)) throw new Error('Existing preparation uses a different source tree.');
    console.log('Existing isolated preparation retained: ' + runtime); return;
  }
  if (fs.existsSync(runtime)) {
    const entries = fs.readdirSync(runtime);
    const onlySource = entries.length === 1 && entries[0] === 'source' &&
      same(source, fs.realpathSync(path.join(runtime, 'source')));
    if (entries.length && !onlySource) throw new Error('Runtime contains files other than the controlled source tree; existing files were preserved.');
  }
  command('git', ['-C', REPO, 'check-ignore', '--quiet', '--', path.join(runtime, 'credentials.json')]);
  const images = { keycloak: imageId('quay.io/keycloak/keycloak:26.8.1'), orthanc: imageId('orthancteam/orthanc:latest') };
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const m = makeManifest(runtime, source, images), c = makeCredentials(m);
  fs.mkdirSync(path.join(runtime, 'dicom'), { mode: 0o700 });
  const python = args.python || path.join(REPO, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  command(python, [fileURLToPath(new URL('generate_ct.py', import.meta.url)), '--output-dir', path.join(runtime, 'dicom')]);
  writeJson(m.paths.credentials, c); writeJson(m.paths.realm, makeRealm(m, c));
  writeJson(m.paths.orthanc, orthancConfig()); writeJson(m.paths.compose, makeCompose(m, c));
  fs.writeFileSync(m.paths.composeEnv, '', { flag: 'wx', mode: 0o600 });
  writeJson(path.join(runtime, 'manifest.json'), m);
  console.log('Prepared isolated stack without starting services: ' + runtime);
}
export function javaArguments(m) {
  return [
    '-Djava.io.tmpdir=' + path.join(m.runtimeRoot, 'java-tmp'),
    '-jar', path.join(m.sourceRoot, 'backend', 'target', 'demo-0.0.1-SNAPSHOT.jar'),
    '--server.address=127.0.0.1', '--server.port=18082', '--app.base-url=' + URLS.portal,
    '--spring.datasource.url=jdbc:h2:mem:work_home_integration;DB_CLOSE_DELAY=-1',
    '--spring.datasource.username=sa', '--spring.datasource.password=',
    '--app.datasets.seed-enabled=false', '--orthanc.base-url=' + URLS.orthanc,
    '--keycloak.issuer-uri=' + m.issuer, '--keycloak.client-id=' + m.clientId,
    '--keycloak.directory-client-id=' + m.directoryClientId,
    '--app.segmentation.cleanup-ms=604800000', '--app.collaboration.scan-ms=604800000',
    '--app.segmentation.work-dir=' + path.join(m.runtimeRoot, 'segmentation'),
    '--app.segmentation.codec-script=' + path.join(m.sourceRoot, 'backend', 'python', 'seg_codec.py'),
  ];
}
async function runHost(kind, runtime, args) {
  const { m, c } = load(runtime);
  const seconds = Number(args['max-seconds'] || 3600);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('Host helpers must have a 1..3600 second lifetime.');
  let program, argv, cwd, env = { ...process.env };
  if (kind === 'java') {
    for (const name of ['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'SPRING_APPLICATION_JSON',
      'SPRING_CONFIG_LOCATION', 'SPRING_CONFIG_ADDITIONAL_LOCATION', 'SPRING_CONFIG_IMPORT', 'SPRING_PROFILES_ACTIVE']) {
      if (env[name]) throw new Error('Clear inherited configuration override before isolated Java launch: ' + name);
    }
    fileWithin(m.sourceRoot, 'backend/target/demo-0.0.1-SNAPSHOT.jar');
    fileWithin(m.sourceRoot, 'backend/python/seg_codec.py');
    for (const dir of ['java-tmp', 'segmentation']) fs.mkdirSync(path.join(runtime, dir), { recursive: true, mode: 0o700 });
    const python = args.python || path.join(REPO, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    env = { ...env, KEYCLOAK_CLIENT_SECRET: c.clients.webSecret,
      KEYCLOAK_DIRECTORY_CLIENT_SECRET: c.clients.directorySecret, SEGMENTATION_PYTHON: python };
    for (const key of Object.keys(env)) if (key.startsWith('SPRING_')) delete env[key];
    program = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
    argv = [...javaArguments(m), '--app.segmentation.python=' + python]; cwd = path.join(m.sourceRoot, 'backend');
  } else {
    fileWithin(m.sourceRoot, 'frontends/portal/dist/index.html');
    fileWithin(m.sourceRoot, 'gateway/runtime-config.mjs');
    const gateway = fileWithin(m.sourceRoot, 'gateway/unified-server.mjs');
    if (!fs.readFileSync(gateway, 'utf8').includes('PORTAL_LOGOUT_ORIGINS')) throw new Error('Isolated gateway lacks the reviewed runtime logout-origin configuration.');
    const imaging = path.join(m.sourceRoot, 'frontends/ohif/platform/app/dist');
    if (fs.existsSync(imaging) && !inside(m.sourceRoot, fs.realpathSync(imaging))) throw new Error('Imaging dist resolves outside isolated source.');
    env = { ...env, PORTAL_PORT: '18080', PORTAL_JAVA_PORT: '18082', PORTAL_LOGOUT_ORIGINS: JSON.stringify([URLS.keycloak]) };
    program = process.execPath; argv = [gateway]; cwd = m.sourceRoot;
  }
  const logPath = path.join(runtime, kind + '.private.log');
  const log = fs.openSync(logPath, 'a', 0o600);
  const child = spawn(program, argv, { cwd, env, windowsHide: true, stdio: ['ignore', log, log] });
  if (child.pid) {
    fs.writeFileSync(path.join(runtime, kind + '-process.json'), JSON.stringify({
      ownerId: m.ownerId, pid: child.pid, startedAt: new Date().toISOString(), maxSeconds: seconds,
    }, null, 2), { mode: 0o600 });
    console.log(`Isolated ${kind} PID ${child.pid}; maximum ${seconds}s; private log: ${logPath}`);
  }
  await new Promise((resolve, reject) => {
    let finished = false;
    const stop = () => child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), seconds * 1000);
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const finish = () => {
      if (finished) return false;
      finished = true; clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); fs.closeSync(log); return true;
    };
    child.once('error', () => { if (finish()) reject(new Error('Isolated child failed; private log retained.')); });
    child.once('exit', code => { if (finish()) code === 0 || code === null ? resolve() : reject(new Error('Isolated child exited nonzero; inspect private log locally.')); });
  });
}
export function parseArgs(argv) {
  const [action, ...values] = argv;
  if (!['prepare', 'up', 'down', 'run-java', 'run-gateway'].includes(action)) throw new Error('Expected prepare, up, down, run-java or run-gateway.');
  const args = {};
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i]?.slice(2), value = values[i + 1];
    if (!values[i]?.startsWith('--') || !['runtime', 'source-root', 'python', 'max-seconds'].includes(key) ||
        !value || value.startsWith('--') || Object.hasOwn(args, key)) throw new Error('Invalid or duplicate integration argument.');
    args[key] = value;
  }
  return { action, args };
}
export async function main(argv) {
  const { action, args } = parseArgs(argv);
  const runtime = validateRuntime(REPO, args.runtime || DEFAULT_RUNTIME);
  if (action === 'prepare') return prepare(runtime, args);
  if (action === 'run-java' || action === 'run-gateway') return runHost(action.slice(4), runtime, args);
  const { m } = load(runtime);
  ownedResources(m);
  command('docker', ['compose', '--project-name', PROJECT, '--env-file', m.paths.composeEnv, '--file', m.paths.compose,
    ...(action === 'up' ? ['up', '-d', '--pull', 'never'] : ['down'])],
    { env: { ...process.env, COMPOSE_DISABLE_ENV_FILE: '1' } });
  console.log(action === 'up' ? 'Isolated containers started; verify readiness before login.' : 'Isolated containers stopped; all data volumes retained.');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
