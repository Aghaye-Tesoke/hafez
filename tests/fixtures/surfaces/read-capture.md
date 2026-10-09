# Rate limit the token endpoint
status: active | type: capture
last-touched: 2026-09-30 | created: 2026-09-30

## Notes

Saw 400 requests a second from one client during the load test.

---
A capture waits to be sorted. Once you can tell what it is, one command:

```
hafez promote rate-limit-the-token-endpoint <entity|project|knowledge>
```
