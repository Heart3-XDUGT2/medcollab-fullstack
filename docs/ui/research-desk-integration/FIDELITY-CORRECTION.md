# A Fidelity Correction - 2026-11-06

The earlier integration was not fully faithful. Three browser regressions were
first reproduced and retained in `.runtime/a-fidelity/red.log`, then fixed:

- Custom order/hidden choices no longer turn the whole desk into full-width
  sections. Main and reference lanes preserve their own relative saved order.
  Settings name those groups explicitly; reading old preferences does not clear
  or rewrite them. Tablet/phone retain each group's order.
- Real visit time and the native dataset selector share the continuation header.
  Recovery limitations remain visible in the context line. Reference metadata
  is compacted without losing real open/favorite/remove-record operations.
- New default `rows` is A's “资料清单”. Existing `cards` remains actual cards
  (“资料索引”); existing `list` remains the comparison table (“对比表格”).
  Version-1 saved values and account isolation remain supported.

Existing users may still need **数据集右上第一个列表图标“资料清单”**, or
**显示设置 > 资料呈现 > 资料清单**. Their old choices are intentionally retained;
refresh is not promised to overwrite them. Exact work-page entry:
http://127.0.0.1:8080/home?view=work

## Measured Against the Approved A

Same synthetic input, fresh preferences, 1440×960:

| Measurement | Approved A | Before Correction | Corrected |
| --- | ---: | ---: | ---: |
| Continuation height | 238.78px | 304.30px | 246.30px |
| Directory top | 474.28px | 573.89px | 479.80px |
| Main width | 990px | 990px | 990px |

Final screenshots and exact metrics:
`frontends/portal/.runtime/a-fidelity/fidelity-final/`.
Long-name, empty/error, menu/drawer and reduced-motion captures:
`frontends/portal/.runtime/research-desk-integration/fidelity-final/`.
Both rounds used intercepted APIs, not live backend acceptance.

TypeScript and 362 unit tests passed. The full candidate browser suite passed
128/128; the final focused confirmation passed 20/20, followed by 20/20 core
tests on the clean production build. Tests cover old stored
card/table values, account switching, grouped order/hidden controls, same-data
geometry, three modes, URL/back/query memory and NIfTI rejection.

## Format Honesty

`.nii`, `.NII`, `.nii.gz` and `.NII.GZ` now produce an immediate unsupported
NIfTI message and cannot start import/create. The same guard exists in the
upload validation boundary. ZIP checks and extensionless DICOM entry remain.
No NIfTI parsing/conversion, backend deletion or fake delete button was added.

## Build and Rollback

Pre-correction source snapshot:
`refs/safety/portal-a-fidelity-20261106`
-> `e2de52e54ed3b6c39f705a7ace74dcb9040851d2`.
It includes earlier uncommitted fixes. Do not reset to HEAD.

Original 21-file dist backup:
repository-root `.runtime/safety/portal-a-fidelity-20261106/dist`;
sibling `manifest.json` was verified before the final direct Vite build.
The clean final dist has 21 files with no test/design-preview entry.
All 88 source hashes stayed unchanged during build, and all ten generated
asset hashes matched the existing gateway at 8080, PID 50980.

- JS `index-CT_2g9Ks.js`:
  `64B1CE2E1947287E468E5B6086C669FB80909E2BCD0425302FC7AA16C65E14D8`
- CSS `index-f2FypFMo.css`:
  `834E15E1090522A88B5B2D80D4B20D44728024099C6AD6A445CC6E6CDCBEEDF7`

Restore that named backup with native PowerShell Copy-Item to roll back static
delivery; restore only correction-owned source paths from the safety snapshot.
Do not clear account preferences or discard unrelated working changes.
No install, backend/OHIF/API-contract change, service restart, commit or push.
