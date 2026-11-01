# Design

## Migration Authority

Preserve the delivered home/account interface and password-form preview. The
scope is local engineering extraction, not a new visual direction. Necessary
exceptions: the password page is image-free because redistribution rights for
the old CT crop were unconfirmed; the independent sample has no thumbnail and
no hard-coded viewer destination.

## Tokens And Layout

- Light page `#f6f8f7`, white working surfaces, ink `#182524`.
- Muted text `#586563`, primary teal `#146b5d`, borders `#dce3df`.
- Restrained independent warning, error and source-category colors.
- Inter 400/500/600/700 via Fontsource, CJK system fallbacks, zero letter spacing.
- Corners 6-8 px, interactive targets at least 44 px.
- File library rail, compact toolbar, one continuous selected-row background.
- Detail drawer at 1200 px and below; list rows adapt at 640 px.
- Brand visible on mobile; demo state remains visible in overlays.

Account forms use a constrained single-column layout. Their whitespace is
intentional and is not filled with decoration, promotional copy or fake images.

## Local UI Boundary

`src/ui/` contains only the small compatibility surface needed by these pages:
forwardRef buttons/inputs, native labels, Lucide icons and Radix dialog/menu
primitives. It does not introduce a new design system or copy the imaging UI.

Radix owns portals, focus trapping, Escape, focus return, modal semantics and
menu keyboard behavior. Page-specific focus restoration and cancellation guards
remain in the migrated components. `styles.css` supplies an explicit minimal
reset and `sr-only`; no Tailwind preflight or host application is assumed.

## Verification

Check default/unconfigured and explicit demo states, fields, menus and overlays
at 1440, 768 and 390 px. Cover keyboard, focus return, list scroll preservation,
reduced motion and unknown-write outcomes. Keep inspection to one batch and one
confirmation batch; do not turn migration into open-ended polishing.

Unit and browser tests in this repository are rerun evidence, not inherited
success claims. Mocked Java responses are not backend integration, and no viewer
or ROI regression result is claimed for this engine-free project.

The migration rerun passed 126 unit/component tests and 33 browser tests. This
includes the existing safety assertions, seven new sample-path checks, two
cross-application navigation checks and the unselected-row menu focus
regression. Returning from rename via Escape or Cancel focuses the stable row
control rather than a removed menu item.

The first screenshot batch covers the three target sizes plus home detail,
sharing, demo file selection, account entry, password preview and its help
dialog. It records no horizontal overflow, page errors or demo API calls.
The single Impeccable scan reports four Inter-family warnings, accepted to
preserve the agreed identity; no scanner suppressions are added.
Independent review accepted this as a standalone UI preview without mandatory
visual rework. The established layout is frozen. Live backend, SSO and imaging
workspace integration remain separate work.

## Assets

No medical-image pixels or old font binaries are shipped. The Inter OFL,
upstream OHIF MIT and runtime-library notices are retained and distributed with
the build. See `THIRD_PARTY_NOTICES.md` and `public/licenses/`.
