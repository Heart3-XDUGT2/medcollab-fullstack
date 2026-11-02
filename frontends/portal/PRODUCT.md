# Product

## Confirmed Scope

MedCollab supports medical AI training-dataset annotation. This repository owns
the generic account entry and dataset library only. It is not a diagnosis or
surgical-planning product, annotation engine, review workflow or training
service.

The current implementation brings the approved MedCollab library prototype into
the unified `medcollab-fullstack` application. Its cold-white, near-black and lake-blue
visual system replaces the earlier migration appearance without replacing the
established account, cancellation or request-safety logic.

## Users And Main Job

Dataset annotators, medical experts and researchers need to identify their
accessible imaging datasets, distinguish created/shared/public access, find a
dataset, upload or manage it, and reach a separately owned workspace.

## Surfaces

All surfaces use Operate mode:

- Dataset home: filters, local search/sort, create, rename, upload, share and
  focus-managed details.
- Account entry: one real server-driven account route and registration route.
- Password preview: isolated form appearance, no password API or fake session.
- Teams: independent team libraries, membership, invite-code joining, leader
  management, team dataset creation and serial import into new or existing datasets.

## Facts And Boundaries

- Cookie session and fresh CSRF protocol are authoritative.
- Dataset IDs are opaque business identifiers, not DICOM UIDs.
- Owner is a relation, not a promise that only one person can see the dataset.
- Shared members have the backend's existing edit and re-share abilities.
- Personal sharing is irrevocable after confirmation, including existing grants.
  The UI offers no revoke action and does not treat the old DELETE route as usable.
- A team is an independent library, not a recipient for one-click personal sharing.
  Current members access its datasets; leaving or removal loses team access.
- Team leadership is local to a team, not a Keycloak-wide administrator role.
  Only the current uploader can delete their own team dataset, according to the
  server's current permission check; deletion is not physical disk recovery.
- Creation time is not annotation-save time; instance count is not task progress.
- Demo requires explicit entry and is memory-only, with no file-byte reads.
- Unconfigured, anonymous, expired, failed and lost-access states stay distinct.
- Never replay an unknown write or send old-account content after a switch.

No project hierarchy, label schema, completion rule, approval, fine permission,
password sharing, export format, model service or clinical claim is inferred.
The handoff documents define current protocol and remaining integration work.

## Verification Boundary

Portal, the real Keycloak theme and OHIF remain independent surfaces. `/teams`
is now a Portal React route and a gateway SPA entry; legacy Java team-page files
are retained as source material. The gateway must still proxy API/auth routes,
serve OHIF under its own fallback and preserve `/mask-drafts.js`.

Local unit tests, intercepted API fixtures and an isolated gateway upstream
verify frontend behavior only. This UI change does not start or deploy Java,
Keycloak, Orthanc or OHIF, and does not claim live multi-account authorization
or clinical validation.
