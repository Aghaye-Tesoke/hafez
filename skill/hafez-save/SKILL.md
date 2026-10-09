---
name: hafez-save
description: >
  Save this session to the Hafez vault. Use when the user invokes hafez-save
  or says "save", "save the session" or "wrap up". Never run it unprompted.
hash: 91351681e779
---

# Save the session

1. List the slugs you read, updated or created this session. Use only those; a slug you did not see in `hafez` output this session does not go in. No slugs: tell the user there is nothing to save and stop.
2. Run this once, with today's date:

```
hafez digest --data '{
  "entities_touched": ["<slug>", "<slug>"],
  "decisions": ["<a decision made this session>"],
  "narrative": "<one to three sentences: what happened and how it connects>",
  "session_date": "<YYYY-MM-DD>"
}' | hafez batch
```

In the JSON, write each apostrophe as `’` (`isn’t`): a straight `'` ends the quoted argument and the save fails.

No pipe (PowerShell 5.1): put the JSON in `summary.json`, then `hafez digest --file summary.json > ops.json`, then `hafez batch --file ops.json`.

3. Tell the user in one line: the session note's slug and the entities it logged to.

`decisions` may be an empty array. Each slug in `entities_touched` gets a session log entry and the session note links them all. An unknown slug fails the save and names the slug: fix the list and run it again. A session already saved is skipped, so a second run does no harm.
