---
name: MedCollab Portal
description: A working medical dataset library for personal and team research
colors:
  primary: "#007fa3"
  primary-hover: "#006c8c"
  primary-pale: "#e9f5f8"
  ink: "#171c1f"
  muted: "#5f6a71"
  ground: "#f7f9fa"
  surface: "#ffffff"
  border: "#e5eaed"
  control: "#c5cfd5"
  selected: "#edf5f7"
  danger: "#ae3638"
  warning: "#8a5818"
typography:
  title:
    fontFamily: "Inter, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
  body:
    fontFamily: "Inter, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  metadata:
    fontFamily: "Inter, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
rounded:
  control: "6px"
  dialog: "8px"
spacing:
  small: "8px"
  group: "16px"
  tablet-gutter: "24px"
  desktop-gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "40px"
---

# MedCollab Portal Design

## Overview

**Creative North Star: "Research Objects, Clear Connections"**

This is the implemented unified Portal visual system, including the personal
library's "资料索引台" direction confirmed on 2026-11-03. Cold-white working planes,
near-black text and a lake-blue accent continue through the account entry,
personal library and independent team library. The original connecting mark
is a local brand asset, not a competitor image.

Personal home defaults to metadata-led dataset index records, with a comparison
list available for repeated scanning. These are two presentations of the same
resources, not separate libraries. Neither uses fabricated medical previews,
recents, review states or progress.

## Colors

Use the primary for the main action and selected feedback; use the neutral
layers for navigation, fields and continuous lists. Warning and danger remain
independent semantic colors, especially for irreversible sharing and deletion.
Do not use source colors as annotation progress or clinical signals.

## Typography

Inter is self-hosted from the locked Fontsource dependency, with system CJK
fallbacks. Use zero letter spacing and tabular figures in comparable columns.
The shared defaults above remain applicable to the account and team surfaces:
object names use 14px semibold and page titles use 24px.
Personal home uses a 26px title (22px on phones), 16px index names (14px in
compact density) and 14px list names; metadata stays at least 12px.
Team-specific metadata was brought up to this minimum in the final focused pass.

## Layout

`PortalShell` supplies a 216px light sidebar, fixed-position account area and
mobile navigation. Home filters may be supplied without coupling the shell to
HomePage state. At 1100px and below the sidebar folds into a 64px mobile header;
the phone header is 60px. Desktop content gutters are 32px, tablet 24px and
phone 18px.

Home and the default team-page navigation use the same `ui/navigation.ts` icon
mapping. Closing mobile navigation with Escape restores focus to its opener.

Personal home uses a centered frame up to 1164px including desktop padding,
leaving a 1100px working width. Its private working ground is `#f6f8fa`; shared
palette defaults above are not a requirement to restyle the team or login pages.
Default index records show the dataset's name, source and optional metadata.
The index uses three columns, two below 1000px and one on phones; collections
of up to three records use a balanced two-column desktop arrangement with an
odd final record spanning the row. An open desktop detail pane reduces the
index to two columns.

The optional comparison list aligns creator, instance count and creation time
in columns. At 641–1100px, compact list names wrap with source below them so
identifying suffixes remain visible. At 640px and below, rows become stacked
identities with trailing actions and a metadata line; the page does not scroll
sideways. The phone title/action band retains search, personal/team scope and
core actions while removing duplicate count/density summaries.

Both layouts support comfortable/compact density and no grouping/source
grouping. Group headings use the real created/shared/public relation; grouped
tables give each source its own `tbody` and `scope="rowgroup"` heading. Search,
sort and selection survive presentation changes. IDs move to optional details,
which become a focus-managed drawer on smaller screens.

Team libraries use the same frame but retain their real membership and ownership
semantics. Do not add a team tab to personal sharing: the backend does not offer
that operation. Login has a complete split brand/authentication composition,
which stacks structurally on phones rather than shrinking typography.

## Elevation & Depth

Working surfaces are flat. Borders and tone changes separate content; shadows
belong to menus, dialogs and drawers. State feedback uses 180ms transitions,
disabled under reduced motion. Do not add gradients, glow or decorative motion.

## Shapes

Controls and personal index records use 6px corners; dialogs use 8px.
Outline icons use local Lucide;
individual datasets have no repeated file-image tile. The brand mark is
`public/brand/medcollab-mark.svg`. No medical images or competitor screenshots
are shipped.

## Components

Reuse `ui/Button`, `Input`, Radix dialogs and menus. Button size classes are
separate from variant classes. Preserve focus trapping, Escape, focus return
and menu keyboard navigation. Shared exports include `Brand`, `PortalShell`
and `AuthLayout`; `ui/ui.css` and `styles.css` own their vocabulary.

### Personal Dataset Presentation

`DatasetCollection` presents the filtered/sorted resources without owning
business state. Names, source and primary actions remain visible in both
"资料索引" (`cards`) and "资料清单" (`list`). Creator, instance count and creation
time can be hidden individually; instance count is not annotation progress and
creation time is not last-save time. Index records are flat, bordered objects,
not medical thumbnail placeholders or nested dashboard panels.

The display control provides layout, density, grouping, optional fields and
reset. New-account defaults are index/comfortable/no grouping/all fields shown;
valid saved preferences, including an earlier list choice, are respected.
Real-account preferences are scoped to this browser and an issuer/subject-derived
account key. Only versioned, whitelisted display values persist, not dataset
content, object IDs, credentials or destinations. Anonymous and demo preferences
are ephemeral; display choices neither change permissions nor write resources.
Preserve settings keyboard operation, Escape and trigger focus return.

Personal sharing always explains that confirmation cannot be revoked.
Existing recipients are managed separately from addable search candidates.
Upload reuses the established serial queue; `targetDataset` appends without
creating another dataset, while `destinationLabel` describes the destination.
Neither changes the HTTP protocol or unknown-result handling.

## Do's and Don'ts

- Do preserve the real/demo boundary, fresh CSRF and identity checks.
- Do distinguish empty, unavailable, signed-out, expired and lost-access states.
- Do keep real team libraries separate from personal sharing.
- Don't imply real-time brush collaboration, saving, review progress or viewer
  loading merely from a rendered button.
- Don't replace clinical or protocol verification with UI screenshots.

The implementation record and actual check results live in
[the existing Portal/team record](../../docs/ui/portal-team-ui/portal-implementation.zh-CN.md)
and [the personal-home implementation record](../../docs/ui/home-personalization/IMPLEMENTATION.zh-CN.md).
The latter links the local confirmation evidence for this surface.

Personal-home final local checks: typecheck, 225 unit tests in 13 files,
41 browser tests and an isolated Vite build passed. The independent screenshot
review reported `Disposition=ship` after inspecting all 12
[confirmation originals](.runtime/home-personalization/confirmation/verification.json):
390px first-screen efficiency, 768px identifying name suffixes, closed-panel
hidden-field captures, retained 1440px direction and the 390px settings panel
passed without obvious visual regression. These ignored runtime files are local
evidence, not shipped product assets. No additional visual cycle followed.

This disposition is screenshot-only. Local fixture verification is not live
backend, multi-account permission, clinical or deployment acceptance. The live
`dist` remained unchanged; no theme preparation, push or deployment occurred.
Inter-family detector warnings retain the established, locally licensed work
font; the earlier scan also reported advisory differences from the prior design
record, so it is not an all-pass detector result.
