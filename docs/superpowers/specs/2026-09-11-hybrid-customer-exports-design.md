# Hybrid customer exports

## Decision

Customer exports use a hybrid execution model. Exports of up to 1,000 records are returned immediately. Larger exports are persisted, processed by the durable background-job queue, written to private object storage, and made available for authenticated download for seven days.

## Selection

The browser never loads every customer id for a store-wide selection. It stores an explicit-id selection for individually selected customers, or a filter snapshot plus exclusions for “Select all”. The server validates the snapshot and calculates the authoritative record count.

## Lifecycle

Background exports move through `QUEUED`, `PROCESSING`, `READY`, `FAILED`, and `EXPIRED`. Workers claim persisted work idempotently, read customers in bounded batches, update progress, stream CSV data to private storage, and retain a safe failure message when processing fails. Redis/BullMQ is the production queue; the in-memory adapter runs the same consumer locally.

## Admin experience

The customer directory keeps immediate page exports. A large selected export returns immediately with a confirmation message. An Exports control lists recent work, progress, failures, expiry, and a download action for ready files. The list continues to work after navigation or page reload.

## Security and retention

Only authorized operations staff can request, list, and download customer exports. Storage keys are never exposed. Downloads pass through an authenticated route and are audited. Ready files expire after seven days and expired objects are removed by recovery/maintenance processing.

## Verification

Contract tests cover selection validation and the synchronous/background threshold. Integration tests cover persisted lifecycle, idempotent processing, private storage, authenticated listing, download metadata, failure recovery, and expiry. Web tests cover both direct downloads and queued feedback.
