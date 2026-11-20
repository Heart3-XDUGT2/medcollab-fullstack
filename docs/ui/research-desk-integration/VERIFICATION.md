# A Integration: Verification and Rollback

Date: 2026-11-06. User-approved local integration, no business commit or push.
Open: http://127.0.0.1:8080/home

## What Changed

The real HomePage/WorkHome now present A's continuation, aligned directory and
reference stream. No preview component, synthetic specimen array or fake account
was imported into production. Real activity/teams, StatisticsModel, API,
identity/CSRF/cancellation and unknown-write safeguards remain authoritative.
Hashes verified eight protected API/activity/statistics/session/team/shell
modules unchanged from the pre-integration snapshot.

Index/list, density, fields, grouping, module order/hidden/default-entry controls
remain functional. New default order is continue/library/recent/favorites/teams;
explicit saved orders are not silently migrated. Work and library search are
separate memory-only inputs, restored only through the verified same-identity
return mechanism. Existing URL/back and earlier action-reduction fixes remain.

## Evidence

- TypeScript passed; 24 unit files, 352 tests passed.
- Full browser suite: 119/119 passed against the same-source temporary
  multi-entry candidate, including isolated preference/statistics harnesses.
- Default production build then removed all temporary test and design entries.
  Clean production artifact: ActionClarity + ResearchDesk smoke 11/11 passed.
- Browser fixtures intercept APIs, unmatched non-GET traffic and real auth.
  Gateway-only test mode serves the built SPA for login-preview document tests.
  These are frontend protocol checks, not real backend/authentication acceptance.
- Initial direct gateway run exposed environment differences: deployment config,
  real SSO redirects, and absent Vite-only HTML harnesses. It was not reported as
  passing. That run reached the existing auth entry; no real credentials were
  used. Final guarded tests do not establish live-login behavior.
- Two bounded visual batches: ready/long name, full library, detail/menu, empty,
  activity/statistics errors, tablet/mobile and reduced motion.
- Fresh independent review opened both A references and all 21 final images:
  **Ship at screenshot scope**, no material visual findings.
- Mechanical detector: no error, 35 palette/type/radius documentation advisories,
  not an advisory-free accessibility audit.

Evidence under `frontends/portal/.runtime/research-desk-integration/`:
`full-confirmed.log`, `unit-final.log`, `production-smoke.log`,
`production-assets.json`, and `final/{1440,768,390}-*.png`.

## Build and Server

Used existing Node/Vite directly, with no install, backend/Docker startup,
gateway configuration change, or OHIF/API-contract change.
Final `node node_modules/vite/bin/vite.js build --outDir dist` passed.
All 88 source files had unchanged SHA-256 values across the build.
Final dist has 21 files, no fixture/design-preview entry or preview data import.
HTML and all ten generated assets matched the existing gateway's SHA-256.

- JS: `index-C51H4moo.js`
  `6AEF2E93B20CBF1B8F21E69E137B7C9C5D5C2770CEDAC905AC17A62F8C0CF61B`
- CSS: `index-OjM9YkGd.css`
  `3F36AD39D982AF52C3E1DFED5103511289894C20FDD7D2301ED8572480860C53`
- Existing gateway: 8080, PID 50980, Java port 8082. Health/HTML/assets read-only
  checks succeeded. The separate A preview at 60835 and its build were not changed.

## Rollback

Pre-integration tracked and nonignored-untracked source snapshot:
`refs/safety/portal-research-desk-integration-20261106`
-> `3548c1144a942560cb08acad2dc245532a813150`.
It includes earlier uncommitted action-reduction work; do not reset to HEAD.

Original dist backup, repository-relative:
`.runtime/safety/portal-research-desk-integration-20261106/dist`.
Sibling `manifest.json` records all 21 original files; every hash was verified
after backup and again before the final build. Native PowerShell Copy-Item can
restore that dist over the intended original directory. Restore source only
for the integration's Portal presentation paths, preserving unrelated work.
No recursive deletion, whole-repository reset or service restart is needed.

Live multi-account authorization, true workspace/annotation persistence and
clinical correctness were not tested. Existing saved custom compositions may
look different from the new default by design; their explicit choices win.
