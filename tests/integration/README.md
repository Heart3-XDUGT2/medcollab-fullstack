# Isolated Work-Home Integration Stack

This is test tooling, not a production login bypass or deployment script.
Executor 1 owns the Portal Playwright spec; these files own stack preparation,
synthetic DICOM generation and bounded service helpers only.

## Contract

From the repository root, with an independently prepared source/build directory:

```powershell
node tests/integration/stack.mjs prepare --source-root C:\ABSOLUTE\isolated-source
node tests/integration/stack.mjs up
node tests/integration/stack.mjs run-java
node tests/integration/stack.mjs run-gateway
node tests/integration/stack.mjs down
```

`prepare` does not start services or build anything. `up` starts only the two
isolated Docker services and uses existing local images (`--pull never`).
`down` stops only this Compose project and NEVER passes `-v`.
Java/gateway helpers run in the foreground with a maximum lifetime of one hour;
run each in a separate hidden helper process when orchestrating on Windows.
Stop the recorded child PID, not merely its parent helper, when stopping early.
`down` does not kill unrelated host processes, nor does it stop Java/gateway.

Optional `--runtime` must be an absolute child of this checkout's
`.runtime/integration/`; the default is
`.runtime/integration/work-home-live/`. Never place it in deploy, backend/target,
or a production volume. There is no overwrite/reset/delete operation.
An existing complete preparation is reused; incomplete or mismatched state
fails closed. Root owns recovery and source/build preparation.
The runtime may already contain only the controlled `source/` child before
`prepare`; this supports root's source archive/build workflow. Existing secret
files without a complete matching manifest are never replaced.

### Files For Portal Tests

`manifest.json` is the non-secret coordination contract:

```text
schemaVersion: 1
projectName: medcollab-work-home-integration
runtimeRoot, sourceRoot
urls.portal: http://127.0.0.1:18080
urls.java: http://127.0.0.1:18082
urls.keycloak: http://127.0.0.1:18081
urls.orthanc: http://127.0.0.1:18042
issuer: http://127.0.0.1:18081/realms/medcollab-integration
realm: medcollab-integration
clientId: medcollab-integration-web
directoryClientId: medcollab-integration-directory
users.a: { username: integration-a, subject: <new UUID> }
users.b: { username: integration-b, subject: <new UUID> }
paths.credentials: <runtime>/credentials.json
paths.compose: <runtime>/compose.json
paths.dicomManifest: <runtime>/dicom/manifest.json
dicomFiles: [<runtime>/dicom/synthetic-ct-001.dcm, ...002.dcm]
```

Private `credentials.json` shape (read locally, NEVER log or attach):

```text
keycloakAdmin: { username, password }
clients: { webSecret, directorySecret }
users: { a: { username, password }, b: { username, password } }
```

Passwords and client secrets are random per preparation. Do not persist browser
storageState, traces, login screenshots, cookies, CSRF or authorization responses.
Node requests private file modes; Windows ACL isolation must still be checked by
root because POSIX mode0600 does not establish a Windows access-control boundary.
Use fresh browser contexts and the real `/auth/login` navigation on port18080.
Session issuer/subject must come from real `/api/session`; imported subject UUIDs
are expected values, not a substitute for authentication. No API interception,
test-only login filter, password grant or direct H2 mutation belongs in that spec.

`dicom/manifest.json` identifies two wholly synthetic 16x16 classic CT slices.
Upload them with the normal API, obtain actual Orthanc instance/series IDs from
the backend, and verify totals of 2 (not instanceCount-derived fixture counts).
No patient files are copied or read.

## Runtime Safety

- No original `.env` or generated production realm is read.
- Compose receives an explicit empty runtime env file, not an implicit `.env`.
- Original named volumes, database, JAR, dist and theme are never mounted,
  overwritten or deleted. Only explicitly named integration volumes are used.
- Container/volume ownership labels and generated Compose content are checked
  before `up`/`down`. A different preparation using the same project is rejected.
- Compose ports bind to loopback only. The isolated Orthanc has no original data.
- `run-java` refuses the original sourceRoot/JAR, uses an in-memory H2 and explicit
  highest-priority arguments for every destination. Secrets go through environment.
- Cleanup first execution is delayed seven days; the Java helper terminates its
  child within at most one hour. This is NOT a permanent cleanup-disable switch.
- The collaboration archive scanner runs at startup on an empty DB and then at
  a seven-day interval; tests can deliberately use the normal archive POST.
- Java/gateway logs are local private runtime files. Tool failures do not echo
  subprocess output, which might contain authentication details.

The isolated source must include executor 1's gateway runtime logout-origin
configuration. `run-gateway` runs that gateway unchanged, with
`PORTAL_PORT=18080`, `PORTAL_JAVA_PORT=18082` and
`PORTAL_LOGOUT_ORIGINS=["http://127.0.0.1:18081"]`. Static paths resolve to
the isolated source/build tree. No runtime source substitution, authentication
handler or login bypass is added.

Root must build Portal and Java inside `sourceRoot` first. These helpers never
build or install dependencies. They refuse source symlinks resolving to the
original JAR/dist. Existing original services remain untouched.

## Offline Tool Checks

```powershell
node --test tests/integration/stack.test.mjs
```

These tests do not start Docker, Java, Keycloak or Orthanc. See
`docs/ui/work-home/INTEGRATION-SAFETY.zh-CN.md` for the real acceptance matrix and
the limits of existing mock/OIDC test coverage.

Tool handoff checks: 7 offline Node tests passed; the synthetic CT generator
passed Python AST syntax validation without generating files in the check.
Root subsequently reported successful `prepare`/`up` and isolated Orthanc
readiness. Realm/Compose/manifest/credential generation shapes are now frozen
for that preparation. Real OIDC, HTTP and Portal acceptance results belong to
root and executor 1; these offline checks do not claim those results.
