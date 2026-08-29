# Milestone 3 — Constrained Merchandise Editor Design

- Status: Approved for implementation
- Date: 2026-08-29
- Authority: `docs/MASTER_BUILD_PROMPT.md` and the approved Milestone 3 direction

## Scope

Milestone 3 adds a consumer-first, layer-aware T-shirt editor. It deliberately excludes prepress, production rendering, DPI scoring, Printify profiles, checkout, and generic design-tool capabilities.

## Architecture

`@let-it-be/editor-schema` is a pure TypeScript package. It owns document validation, canonical serialization, normalized-coordinate geometry, placement validation, and document operations. It must not import React, Konva, browser APIs, or a canvas-library type.

The web editor uses React Konva only as a browser rendering and input adapter:

```text
EditorDocumentV1 -> editor-schema operations -> React Konva adapter -> browser scene
```

Konva JSON is never saved. The adapter translates user input into schema operations and rerenders from the canonical document.

## Compatibility

The existing Milestone 1 placeholder shape (`canvas`, `printArea`, `layers`) remains accepted. `migrateEditorDocument` recognizes it and produces a valid empty `EditorDocumentV1` with the development T-shirt print profile. Project versions remain immutable; the next editor autosave writes the versioned canonical shape. No destructive data migration is required.

## Canonical document and coordinate semantics

`EditorDocumentV1` contains a version number, a logical canvas, a development print-area profile, and ordered layers. Layer types are `text`, `image`, and `generated`. Every layer has a stable id; a normalized centre position; normalized width and height; clockwise rotation in degrees; opacity; visibility; lock state; and z-index.

Layer geometry is normalized to the print area, not the viewport. `x`, `y`, `width`, and `height` are fractions of the print-area width/height; `(0.5, 0.5)` is the print-area centre. A crop is a normalized source rectangle. Rendering is source crop, fit to layer box, rotate around centre, then translate. This is deterministic across desktop, mobile, and a later server renderer.

The current profile is clearly development-only. It includes print and safe rectangles, and is not a Printify/provider profile.

## Editing and placement

Simple Mode is the default and exposes only selection, move, resize, rotate, text, font, text colour, centering, undo/redo, save status, boundaries, and an understated quality placeholder. Advanced Mode adds the layer list, reordering, visibility, locking, limited text stroke, and selected-generated-layer regeneration.

Transforms may create an invalid draft so work is never discarded. Placement status is persisted in the canonical document. A design with an invalid visible layer cannot continue toward ordering or be marked ready; the UI identifies the problem in consumer language. Locked layers reject direct transform, deletion, and regeneration targeting.

Snapping uses the print-area centre and safe-area guide lines. Continuous pointer or touch gestures form one history operation when committed rather than one operation per movement.

## History and autosave

The client has a bounded, configurable 50-entry undo/redo history separate from persistence. It records committed operations for move, scale, rotation, crop, text/style edits, ordering, visibility, lock, add, and delete.

Autosave is debounced after committed changes. It serializes only the canonical document and uses the existing project revision. The existing stable-hash behavior skips unchanged documents. A 409 stale-write response leaves the local draft intact and presents recovery/reload options; it does not silently overwrite another document.

Generation insertion and successful selected-element replacement use the existing immutable version mechanism so the prior state remains recoverable.

## Assets and regeneration

Editor documents store asset IDs and generation IDs only. An authorized same-origin preview route checks project ownership for both user accounts and opaque guest sessions, reads the private preview object server-side, and returns only preview bytes. It exposes no source key, source object, permanent storage URL, or provider diagnostics.

Successful Milestone 2 results can be inserted as `GeneratedLayer`s using their preview asset IDs. Image-layer support accepts project assets through the same preview boundary; upload UI is not expanded unless needed for that integration.

Selected generated-layer regeneration uses a provider-neutral `SELECTED_ELEMENT_EDITING` task. It retains locked/unselected layer references as context, creates a normal generation lifecycle record, and updates only the selected layer after successful delivery. Provider adapters remain outside editor code.

## Fonts and accessibility

The font list is intentionally small and consists of stable IDs for commercially usable, server-embeddable open fonts. The browser loads declared web-font assets rather than relying on local system fonts; a future production renderer resolves the same IDs.

Controls have labels, focus states, keyboard access where practical, and text labels in addition to colour swatches. Mobile uses large controls and a compact bottom-sheet-style inspector; desktop uses a restrained side inspector. The product preview remains visually dominant in both layouts.

## Verification

Tests cover document migration and validation, geometry, transforms, crop/text/font persistence, layer commands/locks/history, autosave/stale behavior, generated-layer insertion, preview authorization, regeneration routing, product-colour preservation, and placement blocking. Browser smoke coverage exercises representative desktop and mobile editor interaction.

## Scope guardrails

No production render, effective-DPI engine, printability score, provider-specific print profile, Printify integration, generic filters, freehand tools, masks, front/back print, sleeves, 3D preview, checkout, or production workflows are part of this milestone.
