# Product

## Confirmed Scope

MedCollab supports medical AI training-dataset annotation. This repository owns
the generic account entry and dataset library only. It is not a diagnosis or
surgical-planning product, annotation engine, review workflow or training
service.

This is a migration of an approved interface, not a redesign. Product and visual
decisions come from the explicit migration brief and the delivered source.

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

## Facts And Boundaries

- Cookie session and fresh CSRF protocol are authoritative.
- Dataset IDs are opaque business identifiers, not DICOM UIDs.
- Owner is a relation, not a promise that only one person can see the dataset.
- Shared members have the backend's existing edit and re-share abilities.
- Creation time is not annotation-save time; instance count is not task progress.
- Demo requires explicit entry and is memory-only, with no file-byte reads.
- Unconfigured, anonymous, expired, failed and lost-access states stay distinct.
- Never replay an unknown write or send old-account content after a switch.

No project hierarchy, label schema, completion rule, approval, fine permission,
password sharing, export format, model service or clinical claim is inferred.
The handoff documents define current protocol and remaining integration work.
