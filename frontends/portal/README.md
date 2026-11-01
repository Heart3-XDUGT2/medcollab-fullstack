# MedCollab Portal

Standalone account entry and dataset-home UI for a medical AI training-data
annotation platform. React 18, TypeScript, React Router and Vite; no imaging
engine or adjacent checkout is required.

## Start

Use Node.js 24 and pnpm 12.4.1 (the version in `packageManager`).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The dev server binds to
loopback and uses a strict port; it will not silently occupy a different port.

| Route              | Purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `/`                | Redirects to `/home`                                    |
| `/home`            | Dataset library, including an explicit memory-only demo |
| `/account/sign-in` | Platform login and registration navigation              |
| `/sign-in`         | Password-form appearance preview, not a password API    |

The password preview returns to `/home`. There is no viewer route in this
application. Dataset launch and the independent public sample are unconfigured
by default.

## Scripts

| Command             | Purpose                                                 |
| ------------------- | ------------------------------------------------------- |
| `pnpm dev`          | Vite development server on port 5173                    |
| `pnpm typecheck`    | Strict production-source TypeScript check               |
| `pnpm test`         | Vitest unit and component tests                         |
| `pnpm test:watch`   | Interactive unit-test runner                            |
| `pnpm build`        | Type check and production build into `dist/`            |
| `pnpm preview`      | Serve the build on port 4173                            |
| `pnpm test:e2e`     | Playwright tests against an already running 5173 server |
| `pnpm format:check` | Prettier check                                          |

For browser tests, install Chromium once:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Alternatively, use an existing Chromium-based browser:

```powershell
pnpm exec cross-env "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" playwright test
```

The Playwright configuration does not start a server or contact an imaging
service. CI starts this portal explicitly and runs type checking, tests, build
and browser checks.

## Runtime Configuration

Deployment owns `public/config.js`, which loads before the application. Vite
copies it unchanged into the build; production can replace `dist/config.js`
without recompiling. Serve this configuration with revalidation or no-store.
Never put secrets in it.

```js
window.config = {
  medcollab: {
    apiEnabled: false,
    authOrigin: null,
    logoutOrigins: [],
    workspacePath: null,
    publicSamplePath: null,
  },
};
```

- Default: no business API request, no fake login and no cloud-save success.
- `authOrigin`: trusted Java application's pure HTTP(S) origin exposing the
  login/register browser routes; it is not a Keycloak password endpoint.
- `logoutOrigins`: additional trusted origins for the returned SSO logout URL.
- `workspacePath`: trusted same-origin launch path, without a query or fragment.
  The portal supplies business `datasetId`, `access`, `intent` and fixed
  `returnPath=/home`; it does not treat an ID as a DICOM UID.
- `publicSamplePath`: separate, optional, trusted same-origin example path with
  the same validation rules. It never represents the selected business dataset.

The destinations cannot come from query parameters or localStorage. Both launch
entries use ordinary browser navigation so a same-site gateway can route to
another application.

Business requests always use relative `/api`, Cookie credentials, no-store and
fresh session/CSRF checks for writes. This migration adds no development API
proxy or proxy environment variable. Before enabling the API, arrange trusted
same-origin serving/proxying and the authentication callback/return path.
Backend services have not been integrated against this local migration.

## Handoff Documents

- [Backend contract](docs/api/backend-contract.zh-CN.md)
- [OpenAPI](docs/api/openapi.yaml)
- [Frontend handoff index](docs/handoff/README.zh-CN.md)
- [Runtime configuration](docs/handoff/runtime-config.zh-CN.md)
- [Portal and OHIF launch/return contract](docs/handoff/frontend-ohif-contract.zh-CN.md)
- [Integration checklist](docs/handoff/integration-checklist.zh-CN.md)
- [Product scope](PRODUCT.md), [design](DESIGN.md), [source and asset notices](THIRD_PARTY_NOTICES.md)

The protocol documents describe the handed-off backend, not a running Swagger
service or proof of live integration. The separate workspace owns DICOM loading,
annotation, segmentation and training-data output.

## Data And Licensing

Demo data and changes stay in memory and reset on reload or exit. Demo file
selection shows metadata only; it does not read bytes or upload. Real upload is
serial and distinguishes success, already-stored, confirmed failure and unknown
results. Cancellation cannot roll back server-side changes.

No patient images, DICOM files, tokens, credentials, old dependency tree or
unverified CT screenshot is included. The password preview has a complete
image-free layout. Inter is self-hosted from the locked Fontsource package under
SIL OFL 1.1; CJK uses system fallbacks, not redistributed system-font files.

The upstream OHIF MIT notice is retained in [LICENSE](LICENSE). Primary runtime
notices are also shipped in `public/licenses/` and copied into production builds.
Production distribution still requires a lockfile-based review of transitive
license and attribution obligations; this collection is not a complete legal audit.
