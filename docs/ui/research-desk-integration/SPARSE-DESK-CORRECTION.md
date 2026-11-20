# Sparse Desk Correction - 2026-11-06

Local Portal-only correction. No business commit/push, backend/OHIF build,
database write, service restart or dependency installation.

## Actual Changes

- Star centering fixed through symmetric icon padding and a 44px square target,
  not an SVG translation. Preview footer rules now target only the outer footer.
- One card uses one track capped at 680px; two use two tracks; phone metadata
  stretches across its card. Wide viewports >=1800px use a 1600px frame.
  Cards/order preferences remain intact; no objects were fabricated.
- Missing activity capability is explained as unsupported, not object loss.
  Unsupported modules have no retry loop. Lists settle independently; pagination
  errors stay with their list, and unconfirmed favorite states block writes.
  Dataset-scoped mutation 404 still retains object/access semantics.
- Empty continuation no longer promises recent recording on unsupported service.
  NIfTI rejection, identity/CSRF/cancellation, statistics and URL/back stay intact.

## Verification

Two regressions failed before fixes (`.runtime/sparse-desk/red.log`).
Same screenshot scenario, 1904px content viewport:

| Measurement | Before | After |
| --- | ---: | ---: |
| SVG center offset x / y | +5 / 0px | 0 / 0px |
| Star target | 32 x 44px | 44 x 44px |
| Single card | 319.33 x 278.39px | 680 x 229.39px |
| Working frame / outer gutter | 1440 / 232px | 1600 / 152px |

TypeScript passed; 373 unit tests passed; final full candidate browser suite
153/153 passed. Clean production artifact smoke 29/29 passed. Intercepted APIs
cover 0/1/2/12 objects, 1920/1440/768/390, disabled/confirmed stars, long names,
keyboard detail/menu focus, reduced motion, unsupported and partial failures.
No live multi-account/backend/clinical acceptance is claimed.
Home tests now arm user-action reads explicitly instead of fixed startup GET
ordinals, retaining fresh-token/single-write/cancel/no-replay assertions.

Final screenshots and geometry:
`frontends/portal/.runtime/sparse-desk/final/`.
Current runtime lacks activity/statistics capability markers: actual favorite
and recent functions are **not restored by these frontend changes**.

## Sources, Build and Rollback

Uiverse research: `docs/research/uiverse-2026-11-06/executor-2-official-components.zh-CN.md`
in the parent workspace. The official Galaxy archive at
`adbd2adde0a299a3956ea288fb444ec01891ca41` states MIT; references are
2Fl00rian6/empty-dolphin-52 and ErzenXz/horrible-rattlesnake-14.
Only generic hover/focus principles informed existing local primitives;
no external HTML/CSS snippet, asset or new third-party dependency was copied.

Safety source point before visual edits (including concurrent logic progress):
`refs/safety/portal-sparse-desk-20261106`
-> `0a2a0aba844561dc6c6eabd0b748a123e5cd8e59`.
Prior published dist: repository-root
`.runtime/safety/portal-sparse-desk-20261106/dist`, 21 hashes verified twice.
Restore that named backup with native PowerShell Copy-Item for static rollback;
restore source selectively by ownership, never whole-repository reset.

Default direct Vite build produced 21 clean files, no fixture/preview entry;
88 source hashes stayed unchanged across build. HTML and all ten assets matched
the existing 8080 gateway, PID 50980. No new server was started.

- `index-BbrStW8i.js`: `F1E09E49CF6D4841170B3575D2C5550B1B4B613DFFB2443ED8C60A5A26CAB0A0`
- `index-COrbQuCT.css`: `AE8F086B7011708054EC5B6BAA29C11E474A297C5D44D89895CF9F8BC34145E9`
