# Auth Refactor
> Move session handling from cookies to short-lived tokens
status: active | type: project | domain: engineering
parent: platform (Shared services every product team builds on)
last-touched: 2026-09-28 | created: 2026-07-14
related: token-rotation-policy
resource: https://github.com/acme/auth

## Purpose

Stop long-lived cookies from being the only thing between a stolen laptop and an account.

## Brief

Token endpoint is live behind a flag. Web client is on it; mobile still uses cookies. See [[token-rotation-policy]] for the lifetimes.

## Next Actions

- [ ] a702  Migrate the mobile client to the token endpoint (added 2026-09-25)
- [ ] 1800  Remove the cookie fallback (added 2026-08-01) · stale 62d
- [ ] 43bd  Ask security about refresh lifetime · stale, undated
- [x] Ship the token endpoint (added 2026-09-10)

## Session Log

### 2026-09-28 — claude [progress]
Summary: Token endpoint live behind a flag
Web client switched over; no errors in the first day.

---
Write back with one command. Keep the flags you need, drop the rest:

```
hafez update auth-refactor --log "<progress|decision|blocker|research>: <one line>" --body "<detail>" --complete-action a702 --remove-action <handle> --add-action "<text>" --brief "<text>" --current-state "<text>" --related <slug> --parent <slug>
```
