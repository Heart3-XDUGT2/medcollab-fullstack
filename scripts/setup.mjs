import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { root } from './common.mjs';

const deploy = path.join(root, 'deploy');
const envFile = path.join(deploy, '.env');
const realmFile = path.join(deploy, 'generated', 'medical-demo-realm.json');
const checkOnly = process.argv.includes('--check');
if (!checkOnly && (fs.existsSync(envFile) || fs.existsSync(realmFile))) {
  if (!fs.existsSync(envFile) || !fs.existsSync(realmFile)) {
    throw new Error('Incomplete local setup. Restore the matching .env and realm file; existing secrets were not changed.');
  }
  console.log('Local setup already exists; credentials were kept.');
  process.exit(0);
}
const secret = () => randomBytes(32).toString('hex');
const config = {
  KC_BOOTSTRAP_ADMIN_USERNAME: 'admin',
  KC_BOOTSTRAP_ADMIN_PASSWORD: secret(),
  KEYCLOAK_CLIENT_SECRET: secret(),
  KEYCLOAK_DIRECTORY_CLIENT_SECRET: secret(),
  ORTHANC_IMAGE: 'orthancteam/orthanc:latest',
};
const realm = {
  realm: 'medical-demo',
  displayName: 'MedCollab',
  enabled: true,
  registrationAllowed: true,
  resetPasswordAllowed: false,
  loginWithEmailAllowed: true,
  duplicateEmailsAllowed: false,
  rememberMe: false,
  verifyEmail: false,
  sslRequired: 'none',
  loginTheme: 'medcollab-portal',
  internationalizationEnabled: true,
  supportedLocales: ['zh-CN', 'en'],
  defaultLocale: 'zh-CN',
  clients: [
    {
      clientId: 'medical-demo-web',
      name: 'MedCollab Java session login',
      enabled: true,
      protocol: 'openid-connect',
      publicClient: false,
      clientAuthenticatorType: 'client-secret',
      secret: config.KEYCLOAK_CLIENT_SECRET,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: ['http://127.0.0.1:8080/login/oauth2/code/keycloak'],
      webOrigins: ['http://127.0.0.1:8080'],
      defaultClientScopes: ['web-origins', 'acr', 'profile', 'roles', 'email'],
      attributes: {
        'post.logout.redirect.uris': 'http://127.0.0.1:8080/*',
        'pkce.code.challenge.method': 'S256',
      },
    },
    {
      clientId: 'medical-demo-directory',
      name: 'Read-only MedCollab user directory',
      enabled: true,
      protocol: 'openid-connect',
      publicClient: false,
      clientAuthenticatorType: 'client-secret',
      secret: config.KEYCLOAK_DIRECTORY_CLIENT_SECRET,
      standardFlowEnabled: false,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: true,
      fullScopeAllowed: false,
      defaultClientScopes: ['roles'],
    },
  ],
  clientScopeMappings: {
    'realm-management': [{ client: 'medical-demo-directory', roles: ['view-users', 'query-users'] }],
  },
  // This is the service identity required for account lookup, not a human account.
  users: [{
    username: 'service-account-medical-demo-directory',
    enabled: true,
    serviceAccountClientId: 'medical-demo-directory',
    clientRoles: { 'realm-management': ['view-users', 'query-users'] },
  }],
};
if (checkOnly) {
  JSON.parse(JSON.stringify(realm));
  if (config.KEYCLOAK_CLIENT_SECRET === config.KEYCLOAK_DIRECTORY_CLIENT_SECRET) throw new Error('Secret collision.');
  console.log('Setup generation check passed; no files or credentials written.');
} else {
  fs.mkdirSync(path.dirname(realmFile), { recursive: true });
  fs.writeFileSync(realmFile, JSON.stringify(realm, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(envFile, '# Local-only credentials. Never commit this file.\n' +
    Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  console.log('Created deploy/.env and deploy/generated/medical-demo-realm.json. Credentials are stored only in those local files.');
}
