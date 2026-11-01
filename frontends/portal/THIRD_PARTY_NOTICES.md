# Source And Asset Notices

## Migrated Application Source

The account and dataset-home source was extracted from
[medcollab-ohif](https://github.com/Heart3-XDUGT2/medcollab-ohif), notably:

- `abe5bc8a472492753c6e33cea790d4efac698872`: dataset home, API, upload, sharing,
  account entry and tests.
- `a592c82d9`: original password-form appearance preview and its validation.

The upstream code is MIT licensed, Copyright (c) 2018 Open Health Imaging
Foundation. The complete notice is retained in `LICENSE` and
`public/licenses/ohif-MIT.txt`. The original checkout and history are not moved,
rewritten or required to run this application.

The local dialog/menu wrapper retains the original narrow component API while
using published Radix primitives. No imaging UI package or engine is bundled.

## Primary Runtime Notices

| Component                  | Source                                    | License file shipped with the build    |
| -------------------------- | ----------------------------------------- | -------------------------------------- |
| React / React DOM 18.3.1   | Published npm packages                    | `public/licenses/react-MIT.txt`        |
| React Router 6.30.3        | Published npm package                     | `public/licenses/react-router-MIT.txt` |
| Radix UI primitives        | Locked published npm packages             | `public/licenses/radix-MIT.txt`        |
| Lucide React 0.379.0       | Published npm package                     | `public/licenses/lucide-LICENSE.txt`   |
| Inter via Fontsource 5.3.0 | `@fontsource/inter` published npm package | `public/licenses/inter-OFL.txt`        |

Font copyright: 2016 The Inter Project Authors. Fonts remain under SIL OFL 1.1,
not the application's MIT license. Only the declared Latin regular weights are
imported; CJK names in CSS are operating-system fallbacks, not copied binaries.
Package versions and transitive provenance are fixed by `pnpm-lock.yaml`.
Production distribution still requires a lockfile-based review of transitive
license and attribution obligations. This table is not a complete legal audit.

`public/licenses/runtime-transitive-notices.txt` is a supporting snapshot of
available notices from the installed production graph, including transitive
and peer/type packages. It is not a complete production-distribution guarantee.
One source limitation remains: `react-remove-scroll-bar@2.3.8` declares MIT, but
its exact publication license source could not be retrieved. The snapshot
labels a fixed canonical-upstream text from a different package version as a
supplement, not as a verified copy of the 2.3.8 release. Verify that item and the
complete locked distribution before production release.

## Deliberately Excluded Assets

The old `public-ct-roi.png` crop and its medical-image source were not migrated.
The old provenance record did not establish redistribution permission for the
underlying dataset. The OHIF code license does not grant those image rights.
There is no replacement patient, unrelated stock image or empty image frame.

No original image volumes, DICOM files, case data, credentials, browser profile,
old dependency tree, design cache or unverified font binary is included.
Any future medical-image asset requires its own authorization and provenance.

These notices are attribution records, not a medical-accuracy or regulatory
compliance claim.
