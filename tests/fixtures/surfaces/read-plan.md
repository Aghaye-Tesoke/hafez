# Cookie fallback removal
> Order of work for taking the cookie path out
subtype: plan | status: active | domain: engineering
created: 2026-09-20 | last-touched: 2026-09-20
related: auth-refactor

## Goal

No request is authenticated by cookie.

## Steps

1. Mobile client on the token endpoint.
2. Log cookie-authenticated requests for a week.
3. Delete the fallback.

## Dependencies

- [[auth-refactor]] token endpoint out from behind its flag.

---
Write back with one command. Keep the flags you need, drop the rest:

```
hafez update cookie-fallback-removal --status <active|done> --domain <domain> --related <slug>
```
