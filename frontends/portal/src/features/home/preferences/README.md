# Home Display Preferences Integration

Owner: executor 2. Only this directory and its tests/private CSS are edited here.
Executor 1 owns HomePage, its rendering and shared visual tokens.

## Integration Contract

```tsx
import { PreferencesButton, useHomePreferences } from './preferences';

const display = useHomePreferences({
  mode, // 'real' | 'demo' | 'anonymous'
  identity: mode === 'real' ? identity.current : null, // issuer + subject only
});

<PreferencesButton model={display} />
```

`display.preferences`:

```ts
{
  layout: 'rows' | 'cards' | 'list';
  density: 'comfortable' | 'compact';
  groupBy: 'none' | 'source';
  fields: { owner: boolean; instances: boolean; createdAt: boolean };
}
```

Approved A default: rows ("资料清单"), comfortable, no grouping, all three
secondary fields shown. Existing cards remain "资料索引" (actual cards);
existing list remains the comparison table, now labeled "对比表格".
This default applies only to missing/invalid records and explicit reset.
Valid existing personal list preferences are respected, never overwritten by
the page during mount. No duplicate settings UI.

`display.update(patch)` accepts partial values and partial `fields`.
`display.reset()` restores only display defaults, never resource state.
`display.scope` is `account`, `anonymous`, or `demo`.
`display.persistence` reports loading/local/ephemeral/unavailable/recovered.

Name, source/ownership relation and primary actions always remain recognizable.
No fabricated thumbnails, progress, recents, saved searches or new API calls.
Layout/group/density/field changes must not reset search, sort or selected ID.
Do not key/remount the resource page by preference values.

## Persistence Boundary

- Only whitelisted versioned display enums/booleans are persisted.
- Real accounts use a SHA-256-derived issuer+subject key; raw identity,
  resource names/IDs/lists, tokens, invite codes and destinations are never saved.
- Anonymous/demo preferences are memory-only, isolated and reset on context exit.
- Context changes start with the new scope's defaults immediately; late
  storage-key work from a disposed scope cannot read or write storage.
- Missing Web Crypto, denied storage, quota failures, malformed/old/future
  payloads degrade safely without blocking immediate display changes.
- Reset touches only the current account's preference key, not other accounts
  or unrelated localStorage. A failed reset is reported honestly.
- This is local-browser preference storage, not cloud/cross-device sync.

Settings use existing Button/Dialog primitives and shared `--mc-*` tokens.
`PreferencesButton` owns its trigger and non-modal Radix close/focus lifecycle.
`PreferenceControls` is also exported for an inline host surface.

## Verification

- 54 focused tests: schema, hashing, session boundaries, recovery and React/controls.
- 7 isolated browser tests in `tests/e2e/Preferences.spec.ts`.
- Three viewport/four state screenshots in ignored
  `.runtime/ui-screens/preferences/confirm/`.
- The browser fixture is `/src/features/home/preferences/fixture.html`, not a
  production route or a substitute for HomePage integration acceptance.
- Default changes do not force-write stored values. An existing valid list
  preference still wins; reset uses the shared cards/comfortable default.
- Before initial async loading finishes, an explicit user edit wins as the
  complete currently visible configuration; old values are not filled in later.

Focused commands from Portal:

```powershell
node node_modules/vitest/vitest.mjs run src/features/home/preferences
node node_modules/typescript/bin/tsc --noEmit
$env:PORTAL_E2E_BASE_URL = 'http://127.0.0.1:5189'
# Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH only when using an installed browser.
node node_modules/@playwright/test/cli.js test tests/e2e/Preferences.spec.ts --reporter=list --output=.runtime/preferences-e2e-results
```

No dependency additions, backend calls, build/dist writes or deployment here.
