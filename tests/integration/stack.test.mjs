import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  inside, validateRuntime, makeManifest, makeCredentials, makeRealm, makeCompose,
  javaArguments, parseArgs, REPO, PROJECT, URLS,
} from './stack.mjs';

const runtime = path.join(REPO, '.runtime', 'integration', 'stack-tool-unit');
const source = path.join(runtime, 'source');
const images = { keycloak: 'sha256:' + '1'.repeat(64), orthanc: 'sha256:' + '2'.repeat(64) };
const manifest = () => makeManifest(runtime, source, images);

test('runtime must remain a strict child of the integration workspace', () => {
  assert.equal(validateRuntime(REPO, runtime), runtime);
  for (const target of [REPO, path.join(REPO, '.runtime', 'integration'), path.join(REPO, 'deploy'), 'relative-runtime']) {
    assert.throws(() => validateRuntime(REPO, target));
  }
  assert.equal(inside(runtime, runtime), false);
  assert.equal(inside(runtime, path.join(runtime, '..', 'other')), false);
});
test('CLI has no destructive reset, volume-delete, shell or arbitrary command surface', () => {
  assert.deepEqual(parseArgs(['prepare', '--source-root', source]), { action: 'prepare', args: { 'source-root': source } });
  for (const argv of [['down', '-v'], ['reset'], ['up', '--force', 'yes'], ['up', '--runtime'], ['up', '--runtime', runtime, '--runtime', runtime]]) {
    assert.throws(() => parseArgs(argv));
  }
});
test('manifest is non-secret, uses distinct ports, synthetic IDs and two runtime-only CT paths', () => {
  const m = manifest();
  assert.equal(m.projectName, PROJECT);
  assert.deepEqual(m.urls, URLS);
  assert.equal(m.dicomFiles.length, 2);
  assert.ok(m.dicomFiles.every(file => inside(runtime, file) && file.endsWith('.dcm')));
  assert.ok(!/password|webSecret|directorySecret/.test(JSON.stringify(m)));
  assert.notEqual(m.users.a.subject, m.users.b.subject);
});
test('credentials are random on a new preparation and never copied from environment', () => {
  const m = manifest(), first = makeCredentials(m), second = makeCredentials(m);
  assert.ok(first.clients.webSecret !== second.clients.webSecret);
  assert.ok(first.users.a.password !== first.users.b.password);
  assert.ok(first.keycloakAdmin.password !== first.clients.webSecret);
  assert.equal(first.clients.webSecret.length, 48);
  assert.equal(first.users.a.username, 'integration-a');
});
test('realm retains normal code/PKCE flow and read-only directory service roles', () => {
  const m = manifest(), c = makeCredentials(m), realm = makeRealm(m, c);
  const [web, directory] = realm.clients;
  assert.equal(web.publicClient, false);
  assert.equal(web.standardFlowEnabled, true);
  assert.equal(web.directAccessGrantsEnabled, false);
  assert.equal(web.attributes['pkce.code.challenge.method'], 'S256');
  assert.deepEqual(web.redirectUris, ['http://127.0.0.1:18080/login/oauth2/code/keycloak']);
  assert.equal(directory.serviceAccountsEnabled, true);
  assert.equal(directory.fullScopeAllowed, false);
  assert.deepEqual(realm.clientScopeMappings['realm-management'][0].roles, ['view-users', 'query-users']);
  assert.equal(realm.users[0].id, m.users.a.subject);
  assert.equal(realm.users[0].credentials[0].temporary, false);
  assert.equal(realm.loginTheme, undefined);
});
test('compose has fresh owned volumes, loopback-only ports and runtime-only bind sources', () => {
  const m = manifest(), c = makeCredentials(m), compose = makeCompose(m, c);
  assert.equal(compose.name, PROJECT);
  for (const service of Object.values(compose.services)) {
    assert.ok(service.image.startsWith('sha256:'));
    assert.ok(service.ports.every(port => port.startsWith('127.0.0.1:18')));
    assert.ok(service.volumes.filter(volume => volume.type === 'bind').every(volume => inside(runtime, volume.source) && volume.read_only));
    assert.equal(service.labels['org.medcollab.integration.owner'], m.ownerId);
  }
  assert.deepEqual(Object.keys(compose.volumes), ['keycloak-check-data', 'orthanc-check-data']);
  assert.ok(Object.values(compose.volumes).every(volume => !volume.external && !volume.name));
  assert.ok(!JSON.stringify(compose).includes('medcollab-local'));
});
test('Keycloak realm import filename matches the realm without changing credentials or source', () => {
  const m = manifest(), c = makeCredentials(m), realm = makeRealm(m, c);
  const before = JSON.stringify({ manifest: m, credentials: c, realm });
  const compose = makeCompose(m, c);
  const bind = compose.services.keycloak.volumes.find(volume => volume.type === 'bind');
  assert.equal(bind.source, m.paths.realm);
  assert.equal(bind.target, `/opt/keycloak/data/import/${realm.realm}-realm.json`);
  assert.equal(bind.read_only, true);
  assert.equal(JSON.stringify({ manifest: m, credentials: c, realm }), before);
});
test('Java arguments select only isolated storage/destinations and delay the first cleanup', () => {
  const m = manifest(), args = javaArguments(m);
  assert.ok(args.includes('--spring.datasource.url=jdbc:h2:mem:work_home_integration;DB_CLOSE_DELAY=-1'));
  assert.ok(args.includes('--orthanc.base-url=http://127.0.0.1:18042'));
  assert.ok(args.includes('--app.segmentation.cleanup-ms=604800000'));
  assert.ok(args.includes('--app.collaboration.scan-ms=604800000'));
  assert.ok(args.includes('--app.base-url=http://127.0.0.1:18080'));
  assert.ok(!args.some(arg => /secret|password=.+|jdbc:h2:file:/.test(arg)));
  assert.ok(args.includes(path.join(source, 'backend', 'target', 'demo-0.0.1-SNAPSHOT.jar')));
});
