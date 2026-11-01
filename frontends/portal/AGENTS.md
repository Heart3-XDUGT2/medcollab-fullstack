# MedCollab Portal

This repository owns the standalone login and dataset-home frontend. The product
supports medical AI training-dataset annotation. It does not implement diagnosis,
surgical planning, a model-training service, or the annotation workspace.

## Scope And Authority

- Preserve the migrated visual identity and behavior unless the user requests a
  redesign. The migration is not permission to replace the established UI.
- The original source is the `Heart3-XDUGT2/medcollab-ohif` repository, especially
  `abe5bc8a4` for home/account entry and `a592c82d9` for the password-form preview.
  Do not modify or remove that checkout as part of work here.
- Do not add `@ohif/*`, Cornerstone, a DICOM parser, or a 3D engine to this portal.
  The separate workspace owns imaging and annotation.
- Use the actual scripts and package-manager version in `package.json`, the
  committed lockfile, and README. Do not require another local checkout.
- Use the existing local UI primitives. Preserve dialog focus trapping, Escape
  behavior, return focus, accessible names, and menu keyboard interaction.
- Frontend work is implemented locally. Do not upload source, screenshots, or
  medical material to external design-generation services.

## Contracts

- Read `docs/api/backend-contract.zh-CN.md` and `docs/api/openapi.yaml` before
  changing requests. They document the handed-off protocol, not a running server.
- Read `docs/handoff/frontend-ohif-contract.zh-CN.md` before changing launch or
  return navigation. A business dataset ID is not a DICOM UID.
- Runtime destinations are deployment-owned configuration, not query parameters,
  localStorage, user-provided URLs, or credentials embedded in links.
- Keep Cookie sessions and fresh CSRF handling. There is no username/password
  JSON login API. Never fabricate an authenticated user or a token.
- Every write must retain identity checks and cancellation boundaries. Switching
  account, exiting demo, losing access, or unmounting must not send a delayed write
  from an old context. Aborting a request cannot undo a server-side commit.
- Do not automatically retry a write whose outcome is unknown.
- Dataset `access=owner` means relation, not private visibility.
  `instanceCount` is not sample count or annotation progress. `createdAt` is not
  the last annotation-save time.

## Data And Honest States

- Default to backend-unconfigured until deployment explicitly enables the API.
- Demo requires an explicit action. Keep it in memory, separate from real API
  writes and identity. Explain that refresh/exit discards demo changes.
- Do not commit patient files, DICOM volumes, credentials, tokens, `.env` secrets,
  browser profiles, dependency caches, or the original monorepo.
- Preserve the provenance and required notices for copied source and static
  public assets. Do not invent clinical accuracy or regulatory claims.
- Keep empty data, no search matches, unavailable backend, unauthenticated,
  expired session, and lost authorization distinct.
- Do not invent unsupported progress, label schemas, review roles, share
  passwords, fine-grained permissions, training exports, or model functions.

## Verification And Delivery

- Validate type checking, focused tests, production build, and the relevant
  browser flows after changes. Mocked protocol tests are not backend integration.
- Check desktop, tablet, and mobile. Include overlays, long names, empty/error
  states, keyboard focus, and reduced motion where affected.
- Keep visual verification bounded: inspect a batched round, fix the main
  defects together, confirm once. Do not run open-ended polish loops.
- Follow `docs/handoff/integration-checklist.zh-CN.md` for teammate handoff.
- Preserve unrelated local changes. Use scoped commits, do not rewrite history,
  and never change repository visibility without explicit user authorization.
- The initial migration may be committed and pushed to this private repository
  at the user's request. This does not authorize pushes to the old OHIF repo,
  production deployment, new secrets, or future unrelated remote changes.
