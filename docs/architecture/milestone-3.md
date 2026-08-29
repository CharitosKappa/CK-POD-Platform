# Milestone 3 — Constrained Merchandise Editor Architecture

## Scope

Milestone 3 provides the consumer-facing 2D editor only. It is not a production renderer, prepress engine, provider print-profile system, or generic design application.

## Canonical document

`@let-it-be/editor-schema` owns `EditorDocumentV1`. It contains a logical canvas, development print profile, ordered text/image/generated layers, and a persisted placement state. It has no React, Konva, DOM, or browser dependency. Existing Milestone 1 placeholder snapshots are read through `migrateEditorDocument` as empty V1 documents; older immutable records remain unchanged and no destructive migration is needed.

Layer `x`, `y`, `width`, and `height` are fractions of the selected print area. A layer rotates clockwise around its centre. Print-area bounds locate the area on the logical garment canvas; safe-area bounds are fractions within that print area. Rendering applies source crop, fits it into the normalized layer box, rotates around centre, then translates it. This supports consistent desktop/mobile rendering and a future server renderer without storing browser pixels or Konva JSON.

## Browser adapter and UX

The web app uses React Konva only to display and manipulate the canonical document. Konva transforms are converted back to schema commands at gesture completion. The default Simple Mode keeps the product visual prominent and exposes only consumer controls. Advanced Mode shows the layer list, reorder/visibility/lock controls, limited text outline, and selected-artwork refresh. The bundled SIL Open Font License font families have stable IDs (`inter`, `oswald`, `playfair-display`) and do not depend on locally installed fonts.

Visible print/safe boundaries and centre guides use visually secondary dashed lines. A temporary invalid draft is saved with `placementStatus: INVALID`, but its Continue action is hard-blocked until every visible layer is within the safe area. The quality message is explicitly a Milestone 4 placeholder, not a DPI or printability score.

## History and autosave

The browser keeps a configurable bounded history (default 50) for committed commands. Pointer/touch transform movements produce one history entry at completion. The local history is not persisted. Canonical-document autosave is debounced (default 700ms), uses the existing project revision, and skips identical serialized documents. A stale response leaves the local draft intact and tells the user to reload; it never silently overwrites the remote version. Generation insertion or successful regeneration replacement autosaves a new immutable project version, preserving the preceding asset reference.

## Assets and regeneration

Editor documents store asset and generation IDs only. `GET /api/projects/:projectId/assets/:assetId/preview` checks the project owner (account or opaque guest session) and permits only active `PREVIEW` assets. It reads private storage server-side and returns controlled preview bytes with `private, no-store`; source keys and source-output assets cannot be retrieved by this route.

Selected-element regeneration checks that the active layer is an unlocked `GeneratedLayer`, then creates a `SELECTED_ELEMENT_EDITING` request using the existing task-oriented AI runtime. Deterministic local providers support this task for development. Replacement occurs only after a successful result and creates a new project snapshot.

## Milestone 4 placeholders

The development print profile is not a provider-specific physical profile. No production master, effective-DPI calculation, real printability score, provider derivative, or prepress validation is implemented here.
