# Hafez

[![CI](https://github.com/shrvn-r/hafez/actions/workflows/public.yml/badge.svg?branch=main)](https://github.com/shrvn-r/hafez/actions/workflows/public.yml)

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

### Cloud sessions

A Claude Code cloud session (claude.ai/code, the mobile app) starts in a fresh
container: no `hafez`, no vault, no Block. Keep the vault in a private GitHub
repo and print the environment's setup script for it:

```bash
hafez onboard --cloud --vault-repo <owner>/<vault-repo>
```

Paste the script into the cloud environment's Setup script; the Trusted network
policy is enough. It installs Hafez, registers the vault when it is attached to
the session, and writes a Block with one rule more: a session started without
the vault attached attaches it, clones it and registers it, with one approval
from you. The script never clones the vault itself, because it runs without
GitHub credentials. Writes push to the vault's `main` like anywhere else.

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

# See it in context: a live graph of the vault in your browser
hafez graph auth-refactor

# Record progress
hafez update auth-refactor --log "progress: JWT flow implemented"
hafez update auth-refactor --complete-action "migration plan"
```

Every mutating command commits to git and syncs with the remote (if one is configured).

## Core concepts

Three kinds of documents, all markdown + YAML frontmatter:

- **Entities** (`entities/*.md`) — the things you're working on. Types: `capture` (inbox item), `entity` (anything worth tracking), `project` (has outcomes). Statuses: `active | paused | done`. Bodies start from a per-type template (capture: `## Notes`; entity: `## Context`; project: `## Purpose` + `## Goals`) plus a `## Session Log` of dated agent entries; `## Brief` (freeform handoff context) and `## Next Actions` (checkbox list) appear when first written to.
- **Knowledge** (`knowledge/*.md`) — durable insights that outlive any one project. Subtypes `insight | plan`; confidence levels `observation → pattern → principle` (promoted manually). Bodies hold `## Synthesis`, `## Evidence`, and `## Sources` — evidence accumulates over time via `--add-evidence`.
- **Sessions** (`sessions/*.md`) — session summaries written at save time, never updated. Readable (`hafez read <slug>`), listed newest first (`hafez query --kind session`), and the look back from an entity (`hafez query --related-to <slug>`); search and query reach them only under `--kind session` or `--kind all`.

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

Links (`parent`, `related`) are validated — they must point at slugs that exist. A `related` link between two entities, or two knowledge notes, is kept on both files. `hafez validate` checks vault integrity.

## Where your judgement matters

The agent writes to your vault as work lands, without asking. Behind a few of those writes is a judgement no rule in the tool can make, and the Health pass's proposals wait for your yes. Each choice is below as the question, the test, and what happens once it is made, so you can make it, or check the one the agent made.

### 1. Child or related?

**Question:** one piece of work bears on another. Is it part of it, or beside it?

**Test:** would it carry on if the other were finished or dropped? If not, it is a **Child**. If so, the two are **Related**.

**Then:** a Child carries `parent`, the one mark of childhood, and the parent's `read` lists it. Related between two entities, or two knowledge notes, is one edge the tool keeps on both files. A pair is never both: a `related` naming a parent or a child is rejected, and so is a `--parent` naming a related entity. A parent whose own work is coordination only is a **Hub**.

### 2. Split a Workstream or not?

**Question:** an entity's `read` shows a `workstream:` line: its actions share an ALL-CAPS prefix that no Child or related entity carries in its name. Is it a real thread of work, or a habit of phrasing?

**Test:** would you track it, brief it and finish it apart from the parent?

**Then:** split, and the agent does it with ordinary writes: a Child is created under the parent, the open actions move to it, the log entries stay where they are, and one `decision` entry on the parent records the split. Don't, and nothing is written: the line is a fact, not a request, and it goes once those actions are done.

### 3. Decision or lesson?

**Question:** something was settled. Where does it live?

**Test:** is it still true with this entity gone, no slug, path or "we chose" needed? If not, it is a **Decision**; if so, a lesson.

**Then:** a decision is one `decision` entry on the log of the entity that owns the work (or an entry pointing at the repo's own record). A lesson is a knowledge note, related to where it came from. One fact, one place: a knowledge note that only repeats a decision is the Health pass's "restated decision".

### 4. Retire or delete?

**Question:** something in the vault is no longer wanted.

**Test:** is it an entity? Then it is retired. A knowledge or session note can be deleted.

**Then:** retiring sets `--status done`: the entity stays, readable and linked, and leaves the live views unless a Child of it is not yet done. Deleting removes the note in one commit, together with the back-edges it owns (the notes its own `related` names that name it back); any other entity or knowledge note naming it as `parent` or `related` refuses the delete until that link goes. Every write is a git commit, so either can be undone.

### 5. What `hafez health` lists

`hafez health` is the **Health pass**: it reads the vault and lists what placement would change, applying nothing. Run it, or ask the agent to check the vault; a sample of its output is [`health.md`](tests/fixtures/surfaces/health.md).

Its six groups take three kinds of answer. **One-way edges** (a `related` kept on one end only) and **unlinked mentions** (a `[[slug]]` with no edge either way) are mechanical: each comes with the `link` line that adds the edge the vault already implies, so one yes can cover the group. **Workstreams** are question 2, one entity at a time. **Leakage** (a parent's, or a related entity's, log naming an entity since that entity was created: was that its work?), **restated decisions** (question 3) and **recurring names** (a name that keeps coming back in one entity's log and actions) are judged one by one: nothing is proposed for them.

## CLI overview

| Command | What it does |
|---|---|
| `hafez read <slug> [--depth frontmatter\|summary\|full] [--archive]` | Read an entity, knowledge or session note; `--archive` an entity's archived log entries |
| `hafez query [--filter active\|paused\|done\|stale\|capture\|all] [--type] [--kind entity\|knowledge\|session\|all] [--domain] [--tag] [--parent] [--related-to] [--limit]` | Filter and list |
| `hafez search <terms> [--kind entity\|knowledge\|session\|all]` | FTS5 full-text search (default: entities and knowledge) |
| `hafez create <entity\|knowledge> <name> [flags]` | Create a document |
| `hafez capture <name> [--notes]` | Quick inbox capture |
| `hafez promote <slug> <entity\|project\|knowledge>` | Promote a capture upward |
| `hafez delete <slug>` | Delete a knowledge or session note (entities retire with `--status done`) |
| `hafez update <slug> [flags]` | Status, brief, actions, session log, synthesis, evidence… |
| `hafez link / unlink <slug> <target> --relation <parent\|related>` | Manage relationships |
| `hafez batch [--dry-run] [--data '<json>' \| --file payload.json]` | JSON ops (stdin, `--data` or `--file`) → atomic multi-op, single git commit, rollback on failure; dry-run runs the same validation as apply and reports derived slugs |
| `hafez stats` | Vault summary: counts, stale items, recents |
| `hafez changelog --since 7.days.ago` | Git-derived change history |
| `hafez graph [slug] [--port N] [--no-open]` | Interactive, live graph of the vault in the browser (served on 127.0.0.1); a slug opens it focused on that note; `--json [--layers tag,domain,session]` prints `{nodes, edges}` |
| `hafez sync` | Pull remote, push local commits (semantic merge on conflicts) |
| `hafez validate` / `hafez index rebuild` | Integrity check / rebuild the read index |
| `hafez health` | What placement would change: unsplit workstreams, recurring names, leakage, one-way `related` edges and unlinked `[[slug]]` mentions (each with its `hafez link` line), restated decisions; applies nothing |
| `hafez onboard` | Setup status, then the script your agent follows: Mode, install, permissions, seeding |
| `hafez onboard --install --mode <always-on\|invoke-only>` / `--remove` | Write (or remove) the two skills and, always-on, the marked Block in the harness's instructions file |
| `hafez onboard --cloud --vault-repo <owner>/<repo>` | Print the setup script for Claude Code cloud sessions |
| `hafez schema [op] [--examples]` | Machine-readable JSON schema for every operation |
| `hafez export --okf [--out <dir>]` | Read-only OKF v0.1 bundle export |

In the graph, project nodes carry `last_active`, `heat` (0..1) and `heat_source`: `hours` when the entity has a folder `resource` and its time is mined from Claude Code transcripts (timestamps only, never the conversation), `touches` when it has none and heat comes from the vault's own history. The mined hours live in a sidecar, `hours.json`, under the hafez config directory, never in the vault; the graph server rebuilds it at start and every ten minutes. The sidecar also caches each transcript's file path and working folder, so a restart does not rescan unchanged files; it is written owner-only where the OS honours that. `hafez graph --json` carries no heat, and heat needs the entity's `resource` set to its folder. The server's one write is `POST /note/<slug>/finish`, which marks a project finished; it is accepted only from the page the server serves, and the panel's three-step Mark finished control uses it.

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
