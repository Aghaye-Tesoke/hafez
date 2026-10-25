# Platform
> Shared services every product team builds on
status: active | type: project
last-touched: 2026-09-10 | created: 2026-05-01
related: meeting-transcript-pipeline
children: 2 · 5 open actions
  hafez read auth-refactor    Move session handling from cookies to short-lived tokens · 3 open · 2026-09-28
  hafez read billing-service  Invoices and payouts for every product · 2 open · 2026-09-20
workstream: 2 open actions with `QUEUE`; no child named it

## Brief

One team, every shared service.

## Next Actions

- [ ] 0d94  QUEUE Cap the per-tenant depth (added 2026-09-20)
- [ ] 7cce  QUEUE Alert when a job is older than an hour (added 2026-09-20)
- [x] QUEUE Drain the retry backlog (added 2026-09-05)

---
Write back with one command. Keep the flags you need, drop the rest:

```
hafez update platform --log "<progress|decision|blocker|research>: <one line>" --body "<detail>" --complete-action 0d94 --remove-action <handle> --add-action "<text>" --brief "<text>" --current-state "<text>" --related <slug> --parent <slug>
```
