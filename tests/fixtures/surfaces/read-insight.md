# Short-lived tokens beat revocation lists
> Expiry does the work a revocation list has to be asked to do
confidence: pattern | domain: engineering, security
reinforcement-count: 2 | last-reinforced: 2026-09-12
related: auth-refactor

## Synthesis

A token that expires in minutes needs no revocation path for most threats; a list has to be consulted on every request and is the first thing skipped under load.

## Evidence

- 2026-08-03: the cookie incident was a revocation that never propagated.
- 2026-09-12: load test, the list lookup was 40% of auth latency.

## Sources

- https://example.com/token-lifetimes

---
Write back with one command. Keep the flags you need, drop the rest:

```
hafez update short-lived-tokens-beat-revocation-lists --add-evidence "<what you saw>" --add-source "<url or citation>" --synthesis "<the whole insight, rewritten>" --confidence <observation|pattern|principle> --domain <domain> --related <slug>
```
