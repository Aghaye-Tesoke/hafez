## Health

### Workstreams (1)
- platform workstream: 2 open actions with `QUEUE`; no child named it

### Recurring names (1)
- billing-service: `Stripe` in 10 units across 7 days (2026-08-20 .. 2026-09-20)

### Leakage (1)
- platform → billing-service (parent): 1 of 2 entries (50%)

### One-way edges (1)
- platform → meeting-transcript-pipeline: `hafez link meeting-transcript-pipeline platform --relation related`

### Unlinked mentions (1)
- billing-service mentions [[auth-refactor]]: `hafez link billing-service auth-refactor --relation related`

### Restated decisions (1)
- 2026-09-01 platform → webhook-retries-share-one-budget (67%): Webhook retries draw on one shared hourly budget
