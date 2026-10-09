Three renders of what Hafez prints when a new knowledge note's name resembles an existing one. Each fenced block is one complete output.

## Near-match: refused

`create knowledge` writes nothing and exits 5, the slug-exists code. Up to three near-matches are listed, each with its own line: an existing plan gets `--status` instead of `--add-evidence`, and a create with no `--synthesis` leaves `"<evidence>"` to fill in.

````
Error: "Webhook retries share a budget per endpoint" near-matches an existing knowledge note. Nothing was written.

Use it instead:

Webhook retries share one budget (webhook-retries-share-one-budget): Every retry to an endpoint draws on one hourly budget.
```
hafez update webhook-retries-share-one-budget --add-evidence "A burst to one endpoint cannot starve the others."
```

A different note after all: create it anyway.
```
hafez create knowledge "Webhook retries share a budget per endpoint" --synthesis "A burst to one endpoint cannot starve the others." --confidence observation --new
```
````

## Weaker resemblance: written, one relate line

The note is written; the relate line follows the slug. Optional, not due. Nothing follows the slug when nothing resembles.

```
jitter-webhook-retries
Optional, it resembles webhook-retries-share-one-budget: hafez update jitter-webhook-retries --related webhook-retries-share-one-budget
```

## Batch: written, one warning line

`batch` never refuses: a save must not fail on a near-match. The warning follows the `Batch complete` line.

```
Warning: op[0] create knowledge "Webhook retries share a budget per endpoint" near-matches webhook-retries-share-one-budget; batch writes it anyway.
```
