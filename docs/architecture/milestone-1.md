# Milestone 1 — Identity, Product & Projects

## Scope and ownership

The web app creates a secure guest session on the first stateful request. A project belongs either to that guest session or to an authenticated user. Every project access query enforces the current session owner or user owner; unauthorized reads return not found.

Registration and login upgrade the current browser session and atomically migrate its guest-owned projects to the authenticated user. Projects retain their versions, active version, product selection, color, timestamps, and metadata because only the ownership columns change.

## Project and autosave model

`projects` holds ownership, selection, active version, status, expiration, and an optimistic revision. `project_versions` holds immutable, platform-owned JSON documents. Autosave skips byte-equivalent canonical documents and returns a conflict when the client's expected revision is stale.

The canonical document intentionally contains only `canvas`, `printArea`, and `layers` placeholders. No editor, generation, or asset behavior is part of this milestone.

## Catalog

The internal catalog has product models and variants rather than provider objects. The `Essential DTG T-Shirt` seed is development-only: its $29.00 price, image, and color/size data are placeholders, not Printify or production pricing.

## Implementation details and gates

| Item                                                                                                                         | Classification          | Resolution                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| Local password authentication, opaque guest tokens, JSON snapshots, optimistic revision checks, and development catalog seed | `IMPLEMENTATION DETAIL` | Implemented as the smallest maintainable solution in ADRs 0009–0011.                            |
| Product/provider qualification (G3)                                                                                          | `EXECUTION GATE`        | Does not block the development-only catalog or Milestone 1; it blocks production qualification. |

There are no `PRODUCT DECISION REQUIRED` items preventing Milestone 1.

## Verification

Run `pnpm db:up`, `pnpm db:migrate`, `pnpm db:verify`, and `pnpm test:integration` to verify the persistent identity, project, version, and catalog flows. The normal `pnpm test` suite remains database-independent when `DATABASE_URL` is unset.
