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

This is the approved personal-library prototype implemented in the unified
application, not the earlier migration freeze. Cold-white working planes,
near-black text and a lake-blue accent continue through the account entry,
personal library and independent team library. The original connecting mark
is a local brand asset, not a competitor image.

## Colors

Use the primary for the main action and selected feedback; use the neutral
layers for navigation, fields and continuous lists. Warning and danger remain
independent semantic colors, especially for irreversible sharing and deletion.
Do not use source colors as annotation progress or clinical signals.

## Typography

Inter is self-hosted from the locked Fontsource dependency, with system CJK
fallbacks. Use zero letter spacing and tabular figures in comparable columns.
Object names use 14px semibold, page titles 24px, metadata at least 12px.
Team-specific metadata was brought up to this minimum in the final focused pass.

## Layout

`PortalShell` supplies a 216px light sidebar, fixed-position account area and
mobile navigation. Home filters may be supplied without coupling the shell to
HomePage state. At 1100px and below the sidebar folds into a 64px mobile header;
the phone header is 60px. Desktop content gutters are 32px, tablet 24px and
phone 18px.

Home and the default team-page navigation use the same `ui/navigation.ts` icon
mapping. Closing mobile navigation with Escape restores focus to its opener.

Names lead the continuous library rows; source and creator form a secondary
line. Count and creation time align in columns. IDs move to details. List and
source-grouped views share search and selection. Details are optional and
become a focus-managed drawer on smaller screens.

Team libraries use the same frame but retain their real membership and ownership
semantics. Do not add a team tab to personal sharing: the backend does not offer
that operation. Login has a complete split brand/authentication composition,
which stacks structurally on phones rather than shrinking typography.

## Elevation & Depth

Working surfaces are flat. Borders and tone changes separate content; shadows
belong to menus, dialogs and drawers. State feedback uses 180ms transitions,
disabled under reduced motion. Do not add gradients, glow or decorative motion.

## Shapes

Controls use 6px corners and dialogs 8px. Outline icons use local Lucide;
individual datasets have no repeated file-image tile. The brand mark is
`public/brand/medcollab-mark.svg`. No medical images or competitor screenshots
are shipped.

## Components

Reuse `ui/Button`, `Input`, Radix dialogs and menus. Button size classes are
separate from variant classes. Preserve focus trapping, Escape, focus return
and menu keyboard navigation. Shared exports include `Brand`, `PortalShell`
and `AuthLayout`; `ui/ui.css` and `styles.css` own their vocabulary.

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
`../../docs/ui/portal-team-ui/portal-implementation.zh-CN.md`. Local fixture
verification is not live backend or deployment acceptance. Inter-family detector
warnings are accepted to retain the established, locally licensed work font.
