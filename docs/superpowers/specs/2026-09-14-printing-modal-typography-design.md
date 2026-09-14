# Printing Modal Typography Design

## Goal

Make the Printing modal clearly readable on desktop while preserving its compact operations-dashboard density.

## Scope

Only descendants of `.order-printing-modal` change. The compact Printing summary row, the Order Detail page, the admin navigation sidebar, modal dimensions, layout, colors, and behavior remain unchanged.

## Typography scale

- Modal title: 18px.
- Section headings: 15px.
- Primary body text, item names, values, and economic amounts: 14px.
- Labels, timestamps, supporting metadata, and footer creation date: 12px.
- Status badges, readiness indicators, item-state pills, and action buttons: 12–13px according to available space.
- Close control: keep its existing 29px hit area while retaining a clearly legible symbol.

The scale uses modal-local CSS custom properties so all Printing-modal typography can be adjusted consistently without affecting adjacent admin surfaces.

## Layout and responsive behavior

The modal remains 760px wide with the existing maximum height and internal vertical scrolling. Existing two-column status, three-column economics, item-grid, event-list, and mobile layout rules remain intact. Text may wrap naturally where necessary; identifiers and long metadata must not force horizontal overflow.

## Validation

A focused CSS contract test will verify the modal-local typography tokens and key consumers while asserting that the compact `.order-printing-summary` does not consume them. Existing Printing component tests, admin typecheck, full tests, and production build remain required.
