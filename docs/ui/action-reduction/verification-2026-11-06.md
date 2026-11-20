# Portal Action Reduction Verification

Date: 2026-11-06. Local changes only; no commit or push.
Baseline: `fb23c89`, branch `feat/portal-home-layout-motion`.

## Scope and Guidance

Portal frontend only. No backend, OHIF, API, dependency, design-system, or motion changes.
Used local ui-ux-pro-max: verified navigation/back/deep-link search results and the
quick-reference rules for primary actions, progressive disclosure, navigation hierarchy,
overflow menus, state preservation, and cancellation. Button inventory decisions came
from the actual UI, not from an unrelated database search.

## Action Inventory

| Context | Before | After / retained access |
| --- | --- | --- |
| Library navigation | Global entry, preview header entry, preview footer, empty-state entries | Global entry resumes search; footer appears only above six resources and clears hidden search for discovery |
| Dataset information | Name, card footer detail, menu overview, toolbar toggle | Name opens information; existing close button/Escape remain |
| Workspace opening | Resource CTA plus duplicate menu command | One resource CTA; contextual continuation shortcut remains secondary |
| Favorites | Card star plus card menu item | Card star only; list keeps its menu favorite because it has no star |
| Management | More menu and selected detail commands | Both retained: modal detail cannot operate the background menu |
| Mobile navigation | Visible primary nav plus category drawer | Three visible primary destinations; body source filters remain keyboard-operable |
| Settings / refresh | Home settings in both surfaces | Work-only home settings; library display settings; one refresh per surface |

Cards retain name, open, favorite, and more controls. More retains append, rename, and
eligible share commands. Upload/create/account controls, real favorites/recent records,
statistics disclosure, source counts, selected-detail commands, and contextual team
links are retained. No capability is replaced with fabricated data.

## Reproduced Regressions and Fixes

The first five ActionClarity cases failed before product fixes (recorded in the earlier
run); their regression source remains in `tests/e2e/ActionClarity.spec.ts`.

1. View switches left a stale `view` URL. Structured URL updates now participate in history.
2. Source switches left a stale `scope` URL. Source and explicit view now synchronize.
3. Teams/back lost library search, sort, and selection. A one-shot memory-only return
   restores UI state after matching verified issuer/subject and a fresh authorized list.
   Selection must still exist in that list. No search or selected ID enters URL,
   history.state, localStorage, or sessionStorage.
4. Team index return retained `team`, reopening detail on reload. Selection, index,
   deep links, and browser back/forward now synchronize without replacing cancellation.
5. Work preview browse-all inherited a hidden no-match search. The distinct discovery
   action now clears search while keeping the active source/sort.

Added negative account isolation and explicit `view=work&scope=shared` return coverage.
The full suite also exposed a new manual-entry/account-default interaction; clearing
view/scope on account-context reset and demo exit restores the new account's own default.
The original account-default regression remains unchanged and passes.

## Verification

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit`, passed.
- Unit: 24 files, 349 tests passed.
- Browser: final full run, 115 tests passed (including seven ActionClarity tests).
- Navigation/font script: 1440/768/390, 12 screenshots, zero reported errors.
- Browser fixtures are synthetic protocol tests, not two-account live-backend integration.
- CSRF, identity changes, expired access, cancellation, unknown writes, favorite/recent
  mutations, focus return, and read-only statistics coverage remain exercised.
- Screenshots inspected at 1440/768/390: ready, long-name, menu, empty, reduced motion.
  No new overflow or incoherent text/control overlap observed.

Local evidence under `frontends/portal/`:

- `.runtime/action-reduction/e2e-final.log`
- `.runtime/action-reduction/unit-final.log`
- `.runtime/home-section-motion/action-reduction-20261106/`
- `.runtime/ui-screens/navigation-font-final/verification.json`

## Backup and Build

Source safety snapshot: `refs/safety/portal-action-reduction-20261106-94a3f493`,
commit `33ace434a2bff7557c68ea21bb36a15f1fb2790c`. Real index unchanged.

Original dist copied to repository-root
`.runtime/safety/portal-action-reduction-dist-20261106/dist`.
All 21 files verified by SHA-256; sibling `manifest.json` records paths/hashes/sizes.

Built original Portal dist directly with existing Node/Vite:
`node node_modules/vite/bin/vite.js build --outDir dist`.
No install or build.mjs. All 84 source files had unchanged hashes across the build.
New assets: `index-nVoXs6AI.js`, `index-BgdCjTda.css`.
Read-only gateway checks matched the HTML and both asset SHA-256 values to local dist.

Existing gateway: 8080, PID 50980, service `medcollab-portal-gateway-v1`, Java port 8082.
Frontend-only preview: http://127.0.0.1:60835/home, PID 60276.
No backend/Docker startup or real business writes performed.

## Boundaries

Return memory intentionally does not survive full reload, new tabs, or document
navigation to OHIF. It is not annotation-state recovery or persistent medical history.
Existing historical untracked docs were preserved. Root review remains required.
