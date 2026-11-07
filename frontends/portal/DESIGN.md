---
name: MedCollab Portal
description: A working medical dataset library with an adopted Research Desk home
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
  home-ink: "#202829"
  home-muted: "#657072"
  home-ground: "#fff"
  home-primary: "#263a3b"
  home-primary-hover: "#057d8a"
  home-primary-pale: "#e7f2ef"
  home-border: "#e2e7e5"
  home-control: "#cdd6d3"
  home-subtle: "#f0f4f2"
  home-selected: "#edf4f0"
  home-continuation: "#f0f5f3"
  home-coverage-track: "#dbe5e0"
  home-archive-tick: "#536a61"
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
  home-title:
    fontFamily: "Microsoft YaHei, PingFang SC, Inter, sans-serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0"
  home-current-object:
    fontFamily: "Microsoft YaHei, PingFang SC, Inter, sans-serif"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0"
  home-object-name:
    fontFamily: "Microsoft YaHei, PingFang SC, Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0"
rounded:
  control: "6px"
  dialog: "8px"
  home-control: "5px"
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
  home-button-primary:
    backgroundColor: "{colors.home-primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.home-control}"
    padding: "8px 14px"
  home-continuation:
    backgroundColor: "{colors.home-continuation}"
    textColor: "{colors.home-ink}"
    rounded: "{rounded.control}"
    padding: "22px 26px"
---

# MedCollab Portal Design

## Overview

**Creative North Star: "Research Objects, Clear Connections"**

The unified Portal retains cold-white planes, near-black text, lake-blue shared
defaults and its original local connecting mark. The user adopted Research Desk
A for personal home on 2026-11-06. Its local expression, **"Research handoff
desk"**, leads with continuation, aligned objects and quieter references.

Home-specific roles describe scoped overrides for home and its dialogs/detail
surfaces. The 2026-11-07 continuity refinement shares A's chrome, content frame,
CJK-first navigation and command tone with the team library. Team-specific
membership/content structure and the login design remain independent.
Existing authorized datasets, activity and StatisticsModel supply this adopted
surface, not standalone-preview synthetic arrays.

## Colors

Shared primary, neutral, warning and danger roles remain unchanged elsewhere.
Home uses charcoal commands, lake-blue CT readings and mist-green continuation.
Source relation is not annotation progress or a clinical signal.

**The Reading Separation Rule.** Shared-canvas fill and archived-frame tick
describe different readings; neither means medical quality or approval.

## Typography

Inter remains self-hosted from the locked Fontsource dependency. Shared roles
retain system CJK fallbacks; shared object names are 14px semibold and page
titles 24px. Portal team titles now follow home's 26px/500 desktop and 24px phone
hierarchy; a long team-detail name uses 22px on phones. Account pages keep their
existing roles. Letter spacing is zero and comparable figures are tabular.

Home is CJK-first: Microsoft YaHei, PingFang SC, then Inter. Its medium hierarchy
uses a 26px title (24px phones), 23px continuation identity (21px at 1180px;
20px phones), 16px index names (14px compact; 15px phones) and 15px list names.
Metadata is generally 12–13px; coverage counts/notes can be 11px. No new remote
font or viewport-scaled type is introduced.

## Layout

Home retains the existing three top destinations and URL/back behavior. Home,
personal library and teams now share one mounted Portal header and a frame of
at most 1440px (1600px at viewports of 1800px or wider), with 44px desktop
horizontal padding and a 76px top row plus its 1px boundary. At 641-900px the
shared top row is 66px; phones use the same 64px brand row and 46px navigation
row on every Portal destination. Shared frame tokens own the gutters and
content start, without route-specific `:has()` overrides.
Default document order is continuation, library, recent, favorites, teams.
The desktop 3:1 main/reference grid no longer depends on an exact default
composition. Each lane keeps its saved relative order and hidden choices.
Settings expose those two ordering groups explicitly; stored values are not
cleared or rewritten on read. A missing lane gives its space to available content.
An open desktop detail pane can stack the lanes to keep its content usable.

At 1180px padding becomes 28px and gaps 24px. At 900px the library spans both
columns, continuation/recent retain a 210px rail, and favorites/teams sit below;
main horizontal padding is 24px. At 640px padding is 20px and modules follow
main-lane order then reference-lane order in one column. Continuation's picker
stays in its header alongside the real visit time, and
its open command full-width. The existing detail drawer threshold is 1200px.

The new default `rows` ("资料清单") means A's aligned object records: flexible identity,
100px facts, 180px CT reading and 64px actions with 20px gaps. Hidden facts remove
their lane. Comfortable records use 94px minimum height/15px vertical padding;
compact uses 76px/10px. Phone facts/coverage stack beneath identity, actions trail.
Saved `cards` still means actual cards ("资料索引"). Saved `list` still means the
semantic comparison table ("对比表格"), with optional columns and source rowgroups.
Existing users can select the first List icon or 显示设置 > 资料呈现 > 资料清单
without resetting their other choices.

Sparse card collections use actual object count: one landscape card is capped
at 680px, two use two tracks, and phone cards stack without phantom slots.
Icon commands keep a symmetric 44px hit target; preview footer rules affect only
the preview's own footer, not card commands. Search focus strengthens a stable
boundary without scaling. These are local primitive refinements, not a new skin.

Activity capability, unavailable endpoints, empty lists and lost objects are
distinct. Missing activity capability is explained without a retry loop or fake
zero history. Independent list failures do not hide the other list; unconfirmed
favorite states keep mutations disabled. CT unsupported/stale states remain
owned by the existing statistics model.

Team libraries share the Portal frame and title/command hierarchy while retaining
their membership, dataset layout and ownership semantics.
Shared shell/sidebar defaults remain available elsewhere. Login retains its
split brand/authentication composition and structural phone stacking.

## Elevation & Depth

Working planes are flat; rules and tone separate content. Home detail uses a
tonal plane without shadow. Shared menus/dialogs/drawers retain floating-layer
shadows. Existing feedback/reflow motion remains functional and respects reduced
motion; no decorative animation is introduced. Navigation adds a bounded 240ms
underline handoff and 180ms current-content tonal arrival (90/80ms without spatial
motion). It keeps no outgoing DOM, screenshot, or private-content snapshot, and
does not delay route unmount, cancellation or identity checks.

## Shapes

Shared controls retain 6px corners and dialogs 8px. Home buttons use scoped 5px
corners; continuation keeps 6px. Aligned home records use rules, not floating
cards. Icons remain local Lucide. Existing `public/brand/medcollab-mark.svg` is
the image asset: no new raster, medical image or outside asset is shipped.

## Components

Reuse Button/Input and Radix dialogs/menus, preserving Escape, keyboard
navigation, focus trapping and trigger focus return. Home retains create,
upload, refresh, settings, real serial import and focus-managed detail/actions.
Sharing remains irrevocable after confirmation; teams are independent libraries,
not personal-share recipients.

Index and list retain density, grouping and optional creator/instance/date
fields. Search, sort and selection remain functional. New defaults are
rows/comfortable/ungrouped/all fields visible; valid saved display/composition
choices remain authoritative. Whitelisted preferences are browser-local and
issuer/subject-scoped. Anonymous/demo choices remain ephemeral.

Home-directory and full-library queries are separate memory-only strings.
Same-identity team return restores both through existing verified one-shot
memory alongside selection, sort and scroll; queries do not enter URL, history
or storage. Home shows up to six matching records and opens the matching library
scope.

Continuation uses a selected accessible object or actual recent record; it does
not recover sequence, view or local draft. Activity retains real loading,
failure, empty, paging and mutation states. Explicit demo stays memory-only and
labels synthetic readings/history.

The same StatisticsModel serves repeated appearances. Desk coverage shows
current fill, archive tick only when an archive exists, and the server
pending-archive flag, never an inference from unequal counts. Expanded details
expose counts and non-clinical meaning. Zero CT, unconfigured, unavailable,
forbidden, missing, stale and archive-error states remain distinct; old values
are labeled.

## Do's and Don'ts

- Do preserve real/demo separation, fresh CSRF, cancellation and identity checks.
- Do honor saved composition and all existing display controls.
- Do distinguish empty, unavailable, signed-out, expired and lost-access states.
- Do keep team libraries independent from personal sharing.
- Don't replace team task structure or the login world when sharing Portal chrome.
- Don't equate instance count, creation date or coverage with medical completion.
- Don't infer pending operations from current/archive count differences.
- Don't claim annotation recovery or live correctness from screenshots.

The local refinement was checked with TypeScript, 373 unit tests, 153 browser
tests and a 29-test clean-artifact confirmation. Synthetic protocol fixtures and
screenshot review do not establish live backend, authorization, deployment or
clinical acceptance. See the repository-level
`docs/ui/portal-home-refinement-2026-11-06.zh-CN.md` for scope and integration
limits. Independent exploration files and generated artifacts are not required
by the production application.
