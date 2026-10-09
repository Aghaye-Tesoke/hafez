Three renders of what `hafez update` prints. Each fenced block is one complete output.

## Success

```
Updated auth-refactor: log added, 1 action ticked, 1 action added.
```

## Success, stale lines remain

```
Updated auth-refactor: log added, 1 action ticked, 1 action added.
2 stale actions remain: 1800, 43bd. Tick what landed, drop what is dead.
```

## Misuse

The error line, then the footer `read` shows for this slug.

````
Error: update has no flag --add-actions. Nothing was written.

---
Write back with one command. Keep the flags you need, drop the rest:

```
hafez update auth-refactor --log "<progress|decision|blocker|research>: <one line>" --body "<detail>" --complete-action a702 --remove-action <handle> --add-action "<text>" --brief "<text>" --current-state "<text>" --related <slug> --parent <slug>
```
````
