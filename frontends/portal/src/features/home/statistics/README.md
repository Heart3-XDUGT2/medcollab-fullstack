# Annotation Statistics Integration

Executor 2 owns only this directory, its isolated tests and
`docs/ui/work-home/statistics.zh-CN.md`. HomePage/collection/layout belong to
executor 1. Do not duplicate this request/cache logic in cards or details.

## Small Integration Surface

```tsx
import {
  useAnnotationStatistics, DatasetCoverage,
  makeSyntheticDatasetStatistics,
} from './statistics';

const statistics = useAnnotationStatistics({
  mode, // 'real' | 'demo' | 'anonymous'
  apiEnabled: config.apiEnabled,
  identity: phase === 'ready' && mode === 'real' ? identity.current : null,
  scopeSignal, // existing parent context signal
  sessionApi: api, // existing getSession; this module never writes
  demoData: syntheticStatsByDatasetId, // optional, memoize; explicit counters only
  onAccessIssue: issue => { /* update local account/resource state; no refresh loop */ },
});
<DatasetCoverage model={statistics} datasetId={dataset.id} variant="compact" />
<DatasetCoverage model={statistics} datasetId={selected.id} variant="detail" active />
```

`DatasetCoverage` lazily requests near-viewport resources by default.
`active={true}` explicitly reads selected details; `active={false}` does not
request. Names, resource state, search and selection remain with the host.

Compact starts closed with a CT shared-canvas / archived percentage summary,
plus synthetic, pending, stale and error states when applicable. Its native
disclosure exposes the full numerator/denominator, archive notes, generation
time and refresh button; Enter/Space toggle it without issuing another read.
Detail remains fully expanded. No host props or request semantics changed.

`useDatasetStatistics(model, id, { enabled?: boolean })` exposes
`{ status, data, stale, error, source, refresh }` to custom host compositions.
Read-only series/personal hooks use the same scoped model and bounded queue.
`model.refreshDataset(id)` / `model.refreshWatched()` are explicit, bounded reads.

States distinguish idle/queued/loading/ready, unconfigured, signed-out,
unsupported capability, forbidden, missing resource, busy(423), read error,
deferred capacity, and missing demo data. Zero is valid data, never a fallback.
Errors retain previous values only where access is still credible, marked stale.

Access issue:
`{status:401|403|404, resource:'account'|'dataset'|'series', datasetId?,seriesId?}`.
Resource 404 is reported only after rechecking v1 capability and the current
issuer+subject. Missing/old health routes do NOT mean dataset deletion.
Each scope reports a given resource access issue at most once. Do not invoke
the host's clear-and-auto-refresh loop from this callback.

## Demo Data

```ts
makeSyntheticDatasetStatistics('demo-id', {
  totalSlices: 12,
  annotatedSlices: 5,
  publishedAnnotatedSlices: 4,
});
```

This creates explicitly synthetic, internally consistent counts. Never pass
`instanceCount` as a CT denominator. Unprovided demo IDs remain unknown, not 0.

## Request Boundaries

- Only existing health/statistics GET endpoints and injected getSession.
- Cookie / no-store / redirect:error; pre/post identity checks and cancellation.
- Real API disabled, demo or unconfirmed identity: zero real requests.
- Shared same-resource request/cache; max 2 active jobs, 16 queued jobs.
- No automatic full-table crawling, retry loop or polling interval.
- A cancelled read has a 5-second cooldown. If a consumer returns during it,
  one scoped timer resumes that read once; releasing all consumers cancels the
  timer. Failed requests do not schedule automatic retries. Overflow is explicit
  `deferred`, with manual reread instead of a hidden full-table queue.
- 30-second successful cache freshness on demand; explicit refresh coalesces.
- Cold statistics reads bounded at 150 seconds; session 15s, health 10s.
- Public health capability is checked before session reads. Missing/old routes
  cause no extra session requests. v1 statistics retain pre/post identity checks.
- Context change, unmount or last active consumer release cancels old work.
- No localStorage/IndexedDB, Labelmap/file downloads, writes or new API paths.
- v1 counts/ratios validated; partial coverage never rounds to displayed 100%.

## Verification

Implementation is ready for host integration. Focused verification on 2026-11-03:
Initial validation: 87 unit tests in 4 files, 10 Playwright tests, product TypeScript and independent
test/fixture TypeScript passed. This is controlled-protocol validation, not a
live backend or permission acceptance.

The independent fixture is `/tests/statistics/index.html`; it is not a production
route or Vite build entry. Its default is explicit synthetic data without API
requests. Protocol mode is for intercepted tests only. A separate local preview
uses `node node_modules/vite/bin/vite.js --config tests/statistics/vite.config.ts`
on port 61037 and an ignored `.runtime/statistics/vite-cache`, leaving the
designated 60833 preview/cache alone.

Run the scoped checks directly from Portal:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p tests/statistics/tsconfig.json
node node_modules/vitest/vitest.mjs run src/features/home/statistics
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:PORTAL_E2E_BASE_URL='http://127.0.0.1:61037'
node node_modules/@playwright/test/cli.js test tests/e2e/Statistics.spec.ts --reporter=list --output=.runtime/statistics/e2e-confirmation
```

Details, evidence and verification limitations are in
`docs/ui/work-home/statistics.zh-CN.md`. Final host regression and isolated
production build remain executor 1's responsibility.

Focused P2 density follow-up: 90 module unit tests and 3 new compact browser
tests passed at 1440/768/390, plus 7 existing protocol/lifecycle browser cases.
The closed summary is at most 64px and keeps 14px
main text; keyboard disclosure and unchanged reads are checked. No additional
screenshot cycle or dist build was run; executor 1 owns the six matching library
confirmation captures and the reviewer owns final disposition.
