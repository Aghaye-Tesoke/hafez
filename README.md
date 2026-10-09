# Hafez

**A knowledge and project vault shared between you and your agents.** *Hafez* (حافظ) is Persian for "the keeper — the one who memorizes," after the poet. Plain markdown files you own, backed by SQLite full-text search and git.

## Why

Humans have short-term context. Agents have session context. Both can think big only about what's loaded right now — so both need a place that carries what happened and where things stand, ready whenever either wants to remember. Hafez is that place: projects with goals, actions, and progress; decisions; the insights that outlive them — a graph of markdown files both of you read.

Writing is the agent's job. As you work, the results organise themselves into the vault — at session end, at the critical points of a project — through a CLI that owns the plumbing: structure, validation, search, index, git. A malformed write fails; links must resolve. No agent decides how to treat your vault, so every agent treats it the same — and its context goes to your content, not your conventions.

The files stay yours. Everything is markdown with YAML frontmatter in a git repo: readable — and editable — in any editor, Obsidian-compatible, diffable, and synced like code. The SQLite index (`.hafez.db`) is a disposable read cache rebuilt from the files; git is the source of truth and the sync mechanism. Nothing is trapped, either: `hafez export --okf` writes the vault as a standard [OKF v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle — Hafez's schema is stricter than OKF's, so the export loses nothing.

## Setup

Hafez is a tool for agents — so let an agent install it. Paste this into
Claude Code (or any agent with shell access):

```text
Set up Hafez, an agent-native knowledge vault (github.com/shrvn-r/hafez):

1. Install the CLI (needs Node.js 22+ and git):
   npm install -g hafez --allow-scripts=better-sqlite3
   Always include that flag: npm 11+ blocks install scripts by default, the
   SQLite bindings need theirs, and the install reports success even when
   they were skipped. npm majors predating the flag print
   "npm warn Unknown cli config" and proceed.
2. Check git identity is configured (git config user.name and user.email);
   if not, ask me for a name and email and set them with git config --global.
3. Create my vault — a git repo with entities/ and knowledge/ directories and an
   initial commit. Suggest ~/vault but ask me where I want it first.
4. Register it: hafez init --register <vault-path>
5. Read hafez help --agent, then verify end-to-end: create a test capture,
   hafez read it back, and show me hafez stats.
6. Run hafez onboard and follow what it prints: ask me how Hafez should
   run, install it (the two skills, and the Block in your instructions
   file), and, if the vault is empty, interview me to seed it with my
   current projects.
```

From then on, just mention your projects by name in any session — the Block
teaches the agent when to read and write the vault, no commands required.

Upgrading from an earlier name of this tool? Remove the old skill directory
under `~/.claude/skills/` — two installed skills with near-identical
triggers compete for the same invocations.

### Manual setup

The same thing by hand:

```bash
# Install (Node.js 22+ and git required). Always include the flag: npm 11+
# blocks install scripts by default and the SQLite bindings need theirs;
# older npm majors print "npm warn Unknown cli config" and proceed.
npm install -g hafez --allow-scripts=better-sqlite3

# One-time, if you've never used git on this machine:
#   git config --global user.name "Your Name"
#   git config --global user.email "you@example.com"

mkdir -p ~/vault/entities ~/vault/knowledge
cd ~/vault && git init && git commit --allow-empty -m "init vault"

hafez init --register ~/vault           # remember this vault (one-time)
hafez init                              # show current vault resolution

# Then, in Claude Code or Codex: "run hafez onboard and follow it" —
# guided setup (choose how Hafez runs, install the two skills and the Block,
# seed an empty vault)
```

Prefer installing without the npm registry? The GitHub release tarball is the
same artifact, running the same install scripts, so it takes the same flag —
plus `--allow-remote=root`, which npm 12+ requires for a remote URL:

```bash
npm install -g https://github.com/shrvn-r/hafez/releases/latest/download/hafez.tgz --allow-scripts=better-sqlite3 --allow-remote=root
```

## Updating

Tell your agent: **update hafez**. Or paste: "Run `hafez upgrade` and follow
what it prints."

`hafez upgrade` checks and prints — it never installs. The steps it prints
install code and overwrite your agent instructions file, so **you** approve
them; don't let an agent run them unattended. Re-run `hafez upgrade`
afterwards to verify.

If `hafez upgrade` fails with `Unknown command:`, your installed hafez
predates the command — run the manual steps below once, then use it.

### Updating by hand

```bash
# 1. Install. Same flag rule as a fresh install; <version> is the version you
#    are moving to (npm view hafez version).
npm install -g hafez@<version> --allow-scripts=better-sqlite3

#    From the GitHub release tarball instead (npm 12+ needs --allow-remote):
npm install -g https://github.com/shrvn-r/hafez/releases/download/v<version>/hafez.tgz --allow-scripts=better-sqlite3 --allow-remote=root

# 2. The skills, and the Block if you have one, ship inside the package, so
#    an upgraded package leaves the installed copies stale. The new binary
#    has `hafez upgrade`: it checks them by hash and prints the
#    `hafez onboard --install` line that refreshes them.
hafez upgrade

# 3. Rebuild the read index. A schema bump invalidates it rather than
#    rebuilding it, so the first query after an upgrade can answer empty.
hafez index rebuild
```

The prose above always includes every install flag, because static text cannot
probe your npm — `hafez upgrade` does probe it and prints the exact form your
npm accepts. Same instruction, two renderings; the extra flags are harmless
(`npm warn Unknown cli config`, then it proceeds).

A Hafez section pasted into your instructions file by hand, before the Block
had markers, is not checked: delete it, then install the Block with
`hafez onboard`.

Your vault is untouched by an upgrade: the files, the git history, and the
registered vault path all survive. Only the read index is invalidated.

If any command reports unbuilt SQLite bindings, reinstall with
`--allow-scripts=better-sqlite3` — the CLI prints this itself when it happens.

## Quick start

Whether you drive it or an agent does, the CLI is the whole interface:

```bash
# Create a project
hafez create entity "Auth Refactor" --type project \
  --description "Move auth service to JWT" --add-action "Write migration plan"

# Quick capture for later triage
hafez capture "Look into passkeys" --notes "Saw this mentioned in an RFC"

# Read it back
hafez read auth-refactor

# Query
hafez query --filter active --type project
hafez query --kind knowledge --domain security

# Full-text search across the whole vault
hafez search "token rotation"

# Record progress
hafez update auth-refactor --log "progress: JWT flow implemented"
hafez update auth-refactor --complete-action "migration plan"
```

Every mutating command commits to git and syncs with the remote (if one is configured).

## Core concepts

Three kinds of documents, all markdown + YAML frontmatter:

- **Entities** (`entities/*.md`) — the things you're working on. Types: `capture` (inbox item), `entity` (anything worth tracking), `project` (has outcomes). Statuses: `active | paused | done`. Bodies start from a per-type template (capture: `## Notes`; entity: `## Context`; project: `## Purpose` + `## Goals`) plus a `## Session Log` of dated agent entries; `## Brief` (freeform handoff context) and `## Next Actions` (checkbox list) appear when first written to.
- **Knowledge** (`knowledge/*.md`) — durable insights that outlive any one project. Subtypes `insight | plan`; confidence levels `observation → pattern → principle` (promoted manually). Bodies hold `## Synthesis`, `## Evidence`, and `## Sources` — evidence accumulates over time via `--add-evidence`.
- **Sessions** (`sessions/*.md`) — session summaries written via `batch`, kept as history, not indexed.

Frontmatter at a glance:

| Field | Entities | Knowledge |
|---|---|---|
| `name`, `created` | required | required |
| `type`, `status`, `last-touched` | required | — |
| `description` (one-line summary) | optional | optional |
| `domain` (string[]), `tags`, `related` | optional | optional |
| `parent` (slug) | optional | — |
| `resource` (canonical URI) | optional | — |
| `subtype`, `confidence` | — | optional |

Links (`parent`, `related`) are validated — they must point at slugs that exist. `hafez validate` checks vault integrity.

## CLI overview

| Command | What it does |
|---|---|
| `hafez read <slug> [--depth frontmatter\|summary\|full]` | Read an entity or knowledge note |
| `hafez query [--filter active\|paused\|done\|stale\|capture\|all] [--type] [--kind entity\|knowledge\|all] [--domain] [--tag] [--parent] [--related-to] [--limit]` | Filter and list |
| `hafez search <terms> [--kind ...]` | FTS5 full-text search |
| `hafez create <entity\|knowledge> <name> [flags]` | Create a document |
| `hafez capture <name> [--notes]` | Quick inbox capture |
| `hafez promote <slug> <entity\|project\|knowledge>` | Promote a capture upward |
| `hafez delete <slug>` | Delete a knowledge or session note (entities retire with `--status done`) |
| `hafez update <slug> [flags]` | Status, brief, actions, session log, synthesis, evidence… |
| `hafez link / unlink <slug> <target> --relation <parent\|related>` | Manage relationships |
| `hafez batch [--dry-run] [--data '<json>' \| --file payload.json]` | JSON ops (stdin, `--data` or `--file`) → atomic multi-op, single git commit, rollback on failure; dry-run runs the same validation as apply and reports derived slugs |
| `hafez stats` | Vault summary: counts, stale items, recents |
| `hafez changelog --since 7.days.ago` | Git-derived change history |
| `hafez sync` | Pull remote, push local commits (semantic merge on conflicts) |
| `hafez validate` / `hafez index rebuild` | Integrity check / rebuild the read index |
| `hafez onboard` | Setup status, then the script your agent follows: Mode, install, permissions, seeding |
| `hafez onboard --install --mode <always-on\|invoke-only>` / `--remove` | Write (or remove) the two skills and, always-on, the marked Block in the harness's instructions file |
| `hafez schema [op] [--examples]` | Machine-readable JSON schema for every operation |
| `hafez export --okf [--out <dir>]` | Read-only OKF v0.1 bundle export |

This is not exhaustive — `hafez --help` lists every command, and `hafez schema <op>` prints the machine-readable shape of any op. Add `--json` to any command for structured output.

## Library usage

```typescript
import { createHafez } from 'hafez'

const os = createHafez({ vaultPath: '/path/to/vault' })

const slug = await os.create('entity', 'New Project', {
  type: 'project',
  brief: 'Context here',
  add_action: 'Start design',
})

await os.update(slug, { status: 'active', add_action: 'Write tests' })

const { items } = await os.query({ filter: 'active', type: 'project' })
const results = await os.search('auth pattern')
const note = await os.read(slug, 'full')

// Atomic multi-op — single git commit, rollback on failure
await os.batch([
  { op: 'update', slug, fields: { status: 'done' } },
  { op: 'create', kind: 'knowledge', name: 'What we learned', fields: { domain: ['auth'] } },
])
```

Writes are serialized through an internal mutex, so a single `Hafez` instance is safe to share.

## Agent integration

Hafez is built to be operated by agents — any agent. The CLI is the whole
interface, so every harness that can run shell commands integrates the same
way: through its instructions file — CLAUDE.md for Claude Code, AGENTS.md
for everything on the [AGENTS.md standard](https://agents.md) (Codex, Cursor,
Copilot, …). This repo follows the same convention: `AGENTS.md` is canonical
and `CLAUDE.md` imports it.

- **`hafez onboard`** — agent-directed setup, run from inside Claude Code or Codex (any other harness: `onboard --install --harness <h>`): where things stand (the vault, and per harness found the Block, skills, hook and allowlist), then the script the agent follows — choose always-on or invoke-only, install, allow the command, optionally add the session-start hook, seed an empty vault, and four lines for the user. Re-running it is reconfigure: it walks only what is not current.
- **`hafez help --agent`** — the `hafez` skill body, one text from the same source: the reference an agent reads when the skill is not installed.
- **Two skills, `hafez` and `hafez-save`** — written by `hafez onboard --install` to `~/.claude/skills` and `~/.agents/skills`, so every harness reading either directory gets them: the less common operations and the tool itself, and the session save. The Block, the skills and every sample of command output are rendered from one source and checked byte for byte in CI; the samples are in [`tests/fixtures/surfaces/`](tests/fixtures/surfaces/).
- **`hafez schema <op> --examples`** — JSON schemas with working examples for every batch operation, so agents can self-correct.
- **`hafez batch`** — apply a whole session's worth of updates atomically from a single JSON payload. Validation errors report every bad op at once with did-you-mean hints.
- **Markdown-native output** by default, `--json` everywhere for machine consumption.

## Vault discovery

The CLI resolves the vault in order:

1. `--vault <path>` flag (explicit, highest priority)
2. `~/.config/hafez/vault` (or `$XDG_CONFIG_HOME/hafez/vault`) — a plain-text file containing the vault path, written by `hafez init --register`

If the config points at a path that isn't a vault, the CLI errors loudly instead of silently falling through.

## License

MIT
