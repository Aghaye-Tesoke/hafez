---
name: hafez
description: >
  Hafez vault — personal knowledge base of captures, entities, projects, and
  knowledge notes (subtypes: insight, plan). Use when the user mentions Hafez
  (or types /hafez), asks what's in the vault ("what am I working on?", "what's
  stale?"), wants to create or update an entity or knowledge note, at session
  start to load context for an identifiable topic, at session end to record a
  digest, when a casually mentioned project name might be a vault entity, or
  when the user wants to update the tool itself ("update hafez", "upgrade
  hafez", "is hafez outdated").
---

# Hafez — Vault Operations

All operations go through the `hafez` CLI — it owns reads, writes, validation, and git. Vault files are never edited directly.

If `hafez` is not installed, or `hafez init` reports no vault, stop and follow the setup in the project README (github.com/shrvn-r/hafez) before using this skill. If the vault exists but is empty, run `hafez onboard` and follow what it prints.

## Situation → Command

`hafez help --agent` is the complete, always-current API reference (all commands, flags, batch schema, enum values). This table covers the common situations; consult `help --agent` for anything beyond it.

| Situation | Command |
|-----------|---------|
| Read an entity (incl. a project the user mentions) | `hafez read <slug>` |
| "What am I working on?" / active projects | `hafez query --filter active` |
| Stale items | `hafez query --filter stale` |
| Full-text search | `hafez search "<terms>"` (`--kind knowledge` to narrow) |
| List inbox captures | `hafez query --filter capture` |
| Children of a project | `hafez query --parent <slug>` |
| Related entities/knowledge | `hafez query --related-to <slug>` |
| New workstream | `hafez create entity "<name>" --type project [--brief "context"] [--add-action "task"]` (full flag list in `help --agent`; `--purpose` is project-only) |
| New plan | `hafez create knowledge "<name>" --subtype plan [--status active\|done]` (plans have Goal/Steps/Dependencies — no `--synthesis`; `--status` is plan-only) |
| Quick thought, no classification yet | `hafez capture "<name>"` |
| Promote | `hafez promote <slug> <target>` (capture→entity/project/knowledge, entity→project) |
| Set handoff context / summary / URI | `hafez update <slug> --brief "text"` / `--description "summary"` / `--resource "https://..."` |
| Add / complete a next action | `hafez update <slug> --add-action "task"` / `--complete-action "substring"` |
| Significant milestone (deployed, merged, bug found) | `hafez update <slug> --log "progress: summary" --agent claude` |
| Link entities | `hafez link <slug> <target> --relation related` (or `parent` when a thread belongs to a project) |
| Revise a knowledge insight | `hafez update <slug> --synthesis "text"` (`--insight` is an alias) |
| Back knowledge with evidence / a source | `hafez update <slug> --add-evidence "text"` / `--add-source "url"` |
| Digest session → batch | `echo '{...}' \| hafez digest \| hafez batch` (no pipes? `--file` on both) |

## Session Start — Context Loading

Load context only when a specific entity slug or topic is identifiable from the user's first message:

1. Run `hafez read <slug>` to load entity context
2. If the entity has a `parent`, also read the parent at frontmatter depth: `hafez read <parent> --depth frontmatter`
3. Search for related knowledge (`hafez search "<topic>" --kind knowledge`) and read any relevant note: `hafez read <knowledge-slug>`
4. Present a brief context line: "Loaded context for {name} (status: {status}, next: {next_action})"

## Search-First Ingest

A new knowledge note is a last resort. When an insight emerges or a source (document, conversation, research) is being processed:

1. Search for existing coverage: `hafez search "<topic>"`, narrowing with `--kind knowledge`.
2. A note covers the topic → update it: `--synthesis` to revise the main insight, `--add-evidence` to append support, `--add-source` to cite.
3. Nothing covers it → create it linked from birth (`hafez create knowledge "<name>" --related slug1,slug2`), then write the body via `--synthesis`.

Write `[[wiki links]]` in any knowledge prose (`--brief`, `--synthesis`) to reference related projects, entities, and notes — the CLI does not enforce link syntax; write them naturally in the text. This is what keeps the vault navigable as a wiki.

**Knowledge boundary:** before writing an insight down, ask where it belongs. Useful beyond the current session or repo → vault knowledge note. Specific to one repo's code or workflow → that repo's own docs (CLAUDE.md, README, comments), not the vault.

## Batch Operations

**Rule: Use `hafez batch` when making 2+ mutating calls.** Individual commands auto-commit after each call (and push, when the vault has a remote). Running multiple individual commands back-to-back causes git push races on synced vaults. Batch does all operations in one commit + one push. For a single operation, individual commands are fine — they auto-sync.

```bash
echo '[
  {"op":"update","slug":"foo","fields":{"status":"done"}},
  {"op":"update","slug":"foo","fields":{"session_log":{"type":"progress","summary":"Shipped it","agent":"claude"}}},
  {"op":"update","slug":"bar","fields":{"add_action":"Write tests"}},
  {"op":"create","kind":"entity","name":"New Thing","fields":{"type":"project","brief":"Context here.","add_action":"First task"}},
  {"op":"create","kind":"knowledge","name":"Insight","fields":{"related":["foo"]}},
  {"op":"create","kind":"session","name":"2026-04-06 Session","fields":{"synthesis":"Summary text"}},
  {"op":"update","slug":"k1","fields":{"synthesis":"Updated synthesis text"}}
]' | hafez batch
```

Batch output includes created slugs: `Batch complete: 3 operations (created: new-thing, insight)`

On shells that can't pipe stdin to native executables (Windows PowerShell 5.1), write the payload to a file and use `hafez batch --file payload.json` — same JSON, same behavior. (`cmd /c "hafez batch < payload.json"` also works.)

**Slug contract.** Slugs derive deterministically from names: lowercase, non-alphanumeric runs become single `-` (`"Auth Refactor!"` → `auth-refactor`). Batch executes sequentially, so later ops can reference the slugs of earlier creates in the same payload — create-then-link works in one batch. Collisions hard-error, so a wrong prediction can't touch the wrong document; `hafez batch --dry-run` reports the derived slug for every create op if you want to verify first.

## Session End — Digest

At the end of a working session (or a natural breakpoint), record what happened:

1. Identify the entities touched this session — read, updated, or created, or whose code was worked on. If unsure whether a name maps to an entity, run `hafez search "<term>"`.
2. If no entities were touched (pure tooling work with no vault relevance), skip the digest.
3. Pipe session context through digest into batch (`session_date` is today's real date):

```bash
echo '{
  "entities_touched": ["slug-1", "slug-2"],
  "decisions": ["Decision made", "Another decision"],
  "narrative": "One to three sentence cross-cutting summary.",
  "session_date": "2026-07-31",
  "agent": "claude"
}' | hafez digest | hafez batch
```

On shells that can't pipe (PowerShell 5.1), use files instead — digest stays inspectable in the middle: `hafez digest --file summary.json > ops.json`, then `hafez batch --file ops.json`.

Digest adds a session log entry to each touched entity and creates a session note linking them all. Authoritative field docs: `hafez schema digest`.

Digest itself is pure — it only prints batch JSON; `hafez batch` is what writes. If you are unsure the slugs exist, run `hafez digest` alone first: unknown slugs warn on stderr (they are omitted from the output). Fix `entities_touched`, regenerate, and pipe to batch **once** — re-running the full pipe after a successful batch creates a duplicate session note.

**Mid-session updates and the digest coexist.** Point-in-time updates (`--status done`, `--complete-action`, brief changes) happen as they happen — digest adds the overall narrative on top. Digest builds the session summary itself, so the session's closing log entry comes from digest; reserve hand-written `--log` for significant mid-session milestones (deployed, merged, discovered a bug).

Session end is also when knowledge gets written: review what was learned and run Search-First Ingest on anything worth keeping. Knowledge notes are the primary durable output of sessions — not a side effect.

## Periodic Lint

Run at session end or on demand:

```bash
hafez validate
hafez query --kind knowledge --sort-by last_reinforced --sort-order asc --limit 20
```

Surface orphaned notes (no related links) and the least-recently-reinforced knowledge for review or archival. (`--filter` is entity status — knowledge notes have none, so the query command rejects it under `--kind knowledge`.)

## Updating Hafez Itself

"update hafez" means the **tool**. `hafez update` is an entity update — a different thing entirely. Don't confuse them.

1. Run `hafez upgrade`. It checks and prints; it never installs.
2. Show the user the printed commands **verbatim** and wait for an explicit yes. They install code and overwrite the user's own agent instructions file — never run them unattended, and never run the tarball alternative alongside the npm install.
3. Run the approved steps, then re-run `hafez upgrade` to verify.

If `hafez upgrade` fails with the literal prefix `Unknown command:`, the installed hafez predates it. Install the current version, re-copy the bundled skill, then run `hafez upgrade` — the README's Updating section (github.com/shrvn-r/hafez) has the exact commands.

`hafez upgrade` also prints the current integration snippet. Compare it against the Hafez block in the user's global instructions file and offer to reconcile differences — don't rewrite their file unasked.
