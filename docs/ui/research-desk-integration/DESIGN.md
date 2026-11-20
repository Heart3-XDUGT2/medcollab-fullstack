# Adopted Research Desk Design Record

The user adopted A into real Portal on 2026-11-06. Normative shared and
home-specific tokens live in `frontends/portal/DESIGN.md`; extensions live in
`frontends/portal/.impeccable/design.json`. The original independent preview and
its build remain separate.

Implemented home uses a white plane, charcoal commands, mist-green continuation,
lake-blue CT readings and CJK-first medium typography. These overrides are
scoped to home, its top bar and detail/dialog surfaces, not team/login redesign.
The index now has aligned object/context/facts/reading/action lanes; comparison
list remains a semantic table. Density, grouping, optional fields, source,
search, sort, selection and real actions remain functional.

Default document order is continuation, library, recent, favorites, teams.
Main/reference lanes now retain their relative saved order and hidden choices
without an exact-default layout gate. Settings show those two ordering groups.
Old cards/list values remain cards/comparison; new default rows is A's List.
There is no forced storage migration. Maximum frame is 1440px; horizontal padding moves
from 44px to 28px at 1180px, 24px at 900px and 20px at 640px. Phones follow saved
document order. Separate home/library queries restore through existing
same-identity verified one-shot memory, not URL/history/storage.

Authorized datasets, activity and the existing StatisticsModel own real values.
Current fill/archive tick stay separate; pending comes from the server flag.
Zero, error, stale and archive-error states remain honest. Continuation does not
recover sequence, view or local draft. API/activity/statistics store/backend
contracts are unchanged. Explicit demo remains memory-only and labeled.
No new raster or external assets ship: existing brand SVG, locked local Inter
and system CJK fonts remain the asset vocabulary.

The integration executor reports TypeScript, 352 unit tests and 119 browser
tests passed. Default Vite rebuilt production dist; 88 source hashes were
unchanged across build, 21 output files exclude temporary fixture/preview
entries, and 10 asset hashes match the existing 8080 static server.
One detector run reported 35 advisories from established production
colors/fonts/radii and no error. Fresh independent review inspected all 21 final
captures and returned Ship at screenshot scope, not backend acceptance. Final mocked captures:
`frontends/portal/.runtime/research-desk-integration/final/`.
Frontend evidence proves no live authorization, backend, deployment or clinical
correctness.
