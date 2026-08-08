# Changelog

## 1.4.0 — 2026-08-08

An update path that finally exists, a much faster CLI, and the largest
correctness sweep so far: a full-codebase review turned up roughly
twenty user-visible defects, several of them silently destroying vault
content.

### Highlights

- **`hafez upgrade`** — new command. Checks whether the installed hafez
  is behind the npm registry and whether the installed skill copy has
  drifted, then prints the exact update steps. It never installs: those
  steps install code and overwrite your agent instructions, so the
  privileged step stays yours. Runs pre-vault, so it still answers when
  the vault is unresolvable or the native binding is unbuilt — exactly
  when someone is upgrading. `--json` for machine consumption; every
  check outcome exits 0.
- **Plan lifecycle is reachable.** `status` on the `plan` knowledge
  subtype was documented and schema-validated but had no path to set it
  — only hand-edited files could carry one. Now settable at create
  (`--subtype plan --status active`) and via `update <slug> --status
  done`, across CLI, batch and library. `active | done`, no `paused`.
  Insights still reject it.
- **Non-vault CLI commands start ~5× faster.** Dispatch used to
  statically import the core factory on every invocation — and with it
  the SQLite native binding, git, and YAML parsing. Measured medians:
  `--version` 120ms → 23ms, `help` 123ms → 23ms, `init` 126ms → 52ms.
  Vault commands cost the same as before.
- **Writes stop paying for a full-vault re-parse.** `index.md` now
  renders from the index rows the mutation just updated: 300 entities
  9.0ms → 4.2ms, 1500 entities 30.9ms → 18.3ms, and the gap widens with
  vault size.

### Fixed

- **Section rewrites no longer delete sections.** Structural boundaries
  were derived too narrowly, so any file legitimately carrying a section
  outside its current type's contract — a merged capture's Notes, a
  plan-shaped note with no persisted subtype, a hand edit — had those
  headings demoted to plain text, and the next write silently dropped
  them. Boundaries now bind per file kind: every same-kind heading is a
  boundary. Captures also regain `Current State`, which adjacent
  rewrites had been deleting.
- **An empty flag value can no longer wipe the section it targets.**
  `--synthesis "$VAR"` with `$VAR` unset printed "Updated", exited 0,
  and left an empty section where a paragraph had been. Every
  non-nullable field that writes body text now rejects empty and
  whitespace-only values by name; `--brief ""` still clears, since null
  is its documented clear signal.
- **Conflict merge preserves what both sides wrote.** Three loss paths
  closed: same-day session-log entries from two machines, indented
  sub-bullets and notes under Next Actions, and heading-less archive log
  files that previously merged wholesale with one side winning.
- **Next Action edits stay inside Next Actions.** Completing or removing
  an action matched section-scoped but edited body-wide, so a Brief
  quoting an action got checked while the real action stayed open — and
  `$` patterns in action text were expanded during the replace.
- **Concurrent edits from outside hafez read as races, not bugs.** A
  vault file created or deleted by Obsidian, a hand `rm`, or a git
  checkout between validation and apply used to report "unreachable, file
  a bug" or silently overwrite the intruding file. Both directions now
  raise actionable `NOT_FOUND` / `SLUG_EXISTS`, and nothing is
  overwritten.
- **One calendar-day convention — the local day.** Stamps came from the
  UTC day while comparisons used the local one, so west of UTC after
  ~13:00 local a fresh entity was stamped tomorrow, `query --before
  <today>` excluded it, and `query --since` disagreed with `changelog
  --since` about the same mutation.
- **Search and query apply what you asked for.** Search dropped
  non-Latin queries entirely and crashed on a bare uppercase
  `NOT`/`OR`/`AND`; `query --kind all` silently returned entities only;
  the knowledge and related-to branches dropped `--filter/--type/
  --parent` and the time flags; typo'd `--filter` values ran unfiltered
  at exit 0. Every branch now honours or loudly rejects each flag, and
  enum, sort and paging values are validated for library callers too.
- **The index survives external change.** Re-indexing a hand-edited or
  pulled file left ghost terms behind (integrity-check reported the
  index malformed) and could make search return the wrong document;
  `index rebuild` ran outside the vault lock; and the change-detection
  watermark was stamped late enough that a file written mid-scan was
  skipped by every later sync, permanently stale.
- **Git operations that used to be dead ends.** Adding a remote to a
  previously local-only vault left the branch unpublished and untracked,
  so every subsequent mutation exited 4. Standalone promotes never
  committed at all and vanished from `changelog`. A batch creating then
  cross-kind-promoting the same slug rolled back entirely. `promote …
  knowledge` had no collision check and no mkdir. And `update` swept
  unrelated hand-edits of `entities/archive/` into its commits.
- **Input is applied or rejected, never quietly discarded.** `create`
  dropped whichever flags its kind branch didn't name; empty values to
  the action, evidence and source flags reported success and wrote
  nothing; the `insight` alias worked only through the CLI's batch
  parsing and was dropped on every library path; comma lists went
  untrimmed, so `--domain "ai, ml"` stored `" ml"` where `--domain ml`
  would never match it.
- **Smaller losses swept up:** wiki-links written `[[ with spacing ]]`
  were invisible to link parsing (Related coverage, mention harvesting);
  OKF export wrote a doc slugged `index` over the bundle's own
  `index.md`; worktree vaults skipped local-exclude setup, so the
  generated `index.md` wasn't kept out of git; a duplicate session op
  was a skip in `batch --dry-run` and an error in apply; and the
  better-sqlite3 "reinstall the bindings" hint matched the stack of
  *every* SQLite error, printing build advice over the real message.

### Changed

- **Unknown fields on the public library API are rejected** with the
  batch error shape instead of being silently dropped. Every mutation —
  single-op method or batch — now validates through the same strict
  table.
- **All six single-op methods adopt batch's failure policy**: a commit
  failure rolls files back, a push failure keeps the local commit.
  Previously five had no commit/push failure handling at all, so a
  commit failure left written-but-uncommitted files with a stale index.
- **A create field whose section the chosen template lacks rejects the
  whole op**, naming the available sections, instead of discarding the
  text — `--purpose` with `--type entity`, `--synthesis` on a plan. The
  text is never dropped and never redirected.
- `""` to an enum flag (`--status`, `--confidence`) rejects by name
  instead of no-opping; empty-string clearing extends from `--brief` to
  `--description` and `--resource`.
- `--vault --json` and a trailing `--vault` exit 2 with a usage error
  instead of consuming the next token as the vault path; a duplicate
  `--vault` is a usage error, not last-wins.
- An invalid `subtype` on the direct create path exits 2 instead of
  crashing with a raw TypeError.
- `index.md` membership follows the index: an entity carrying `name` but
  no `created` is skipped by the indexer and no longer appears. It was
  already absent from query, search and stats.
- `findSection` is no longer re-exported from the library API — it is
  Document-internal.
- The shipped skill was rewritten for clarity, and its broken
  stale-knowledge lint replaced with one that works.
- The index schema version bumped, so existing indexes rebuild once on
  first access.

## 1.3.0 — 2026-08-06

The CLI's error surface is now a documented contract — every command
declares its flags, and exit codes are a stable, documented map. Plus a
series of section-handling fixes for bugs that could corrupt document
bodies in hand-edited vaults.

### Highlights

- **Documented exit codes** — `hafez help --agent` now carries the full
  exit-code map, asserted by a contract test. Validation and usage
  errors exit 2; slug collisions (5), git commit failures (6), and vault
  lock exhaustion (7) get distinct codes instead of falling through to a
  generic 1. Agents can branch on the exit code to self-repair payloads.
- **Strict flag parsing** — every command parses through one declared-
  flag parser. Unknown flags and missing flag values are usage errors
  (exit 2) instead of silently ignored tokens, and a flag sitting where
  another flag's value should be (`--brief --clear-actions`) errors
  instead of storing the literal flag text.

### Fixed

- **Section headings with trailing whitespace** (common in hand-edited
  Obsidian vaults) were invisible to section lookups: `--log` created a
  duplicate Session Log section, the 10-entry archival never fired, and
  summary-depth reads returned the full body.
- **Mid-line mentions of section headings no longer corrupt bodies.**
  Current-state/synthesis updates and session-log inserts previously
  matched heading text anywhere in the body, which could truncate
  content or splice entries into the Brief. Section operations now
  target real headings only, and merge treats sections atomically.
- **`update --status` / `--confidence` reject invalid values.** They
  previously wrote straight into frontmatter (exit 0), after which the
  index skipped the file. Now exit 2, matching batch.
- **`promote` keeps its local commit when only the push fails.** An
  unreachable remote no longer rewrites files after the commit landed,
  leaving the worktree contradicting HEAD.
- **Batch updates archive session logs at 10 entries**, matching
  single-op updates and the documented contract.
- **Failed commits leave the read index consistent** — a failed promote
  or batch commit no longer drops rows from queries until a rebuild.
- **`export` and `digest` honor the error contract** — missing `--okf`,
  unknown export flags, and bad digest payloads all exit 2 (previously
  exit 1, or silently accepted).
- **Vaults under a directory named `sessions`** no longer classify every
  file as a session file.
- **`npm run build` keeps the CLI executable** — tsc recreated `dist/`
  without the exec bit, breaking a symlinked install until the next
  `install:local`.

### Changed

- **Usage errors exit 2** (previously 1) across all commands, including
  empty `digest` stdin.
- **`export --okf` skips dotfile `.md` files** (their slugs are
  unreachable by every operation); `validate` no longer counts them.
- **Batch validation reporting unified** — one summary header
  (`Batch failed validation: N invalid operations (0 of M applied)`),
  and a session create referencing an entity created earlier in the same
  batch now warns at validate time instead of silently skipping at
  apply.

## 1.2.0 — 2026-08-02

Fixes from the first fully-external onboarding (Windows 11, PowerShell,
npm 11): Windows is now a first-class platform, and `batch --dry-run` is
a real contract — it can no longer pass a payload the apply rejects.

### Highlights

- **`--file` on `batch` and `digest`** — the portable payload path for
  shells that can't pipe stdin to native executables (Windows PowerShell
  5.1, where the documented pipe idiom fails). Reads UTF-16LE and BOM'd
  UTF-8 (what PowerShell redirection actually writes) as well as plain
  UTF-8. The pipe idiom still works everywhere else.
- **Dry-run parity, by construction** — `batch --dry-run` now runs the
  same validate phase as a real apply: kind rules, slug existence, link
  targets, promote contracts. It also reports the derived slug for every
  create op, and same-batch references validate — create-then-link works
  in one payload.
- **Batch errors localise** — every validation error reads
  `op[<i>] (<op> <slug>): <message>`, and all errors for a payload
  surface at once. No more bisecting a 7-op batch by hand.
- **Slug contract documented** (`hafez help --agent` + skill): slug =
  deterministic slugify(name); batch executes sequentially, so later ops
  may reference earlier creates' slugs; collisions hard-error, so a
  wrong prediction can never hit an existing document.
- **`add_actions` on create** — seed a project with all its next actions
  in one create op, matching update's semantics.
- **Guided bindings failure** — an unbuilt better-sqlite3 module now
  prints the exact `--allow-scripts=better-sqlite3` remedy instead of a
  stack trace (npm 11+ blocks install scripts but reports success).
- **Library:** new `validateBatch()` on the Hafez interface.

### Fixed

- **Windows: every `update` failed.** Entity/knowledge classification
  used a POSIX-only path check, so on Windows all entities were
  classified as knowledge notes and every mutating update was rejected.
  Now separator-agnostic, with win32-path unit tests.
- **`changelog --since <today>` returned nothing.** git fills a bare
  date with the current time of day; date-only input is now normalised
  to local midnight, so "what happened today" works.
- **`stats` recents are true recency lists.** Same-day ties (the shape
  of every new vault) now break on git commit time instead of leaking
  index row order, which produced alphabetical lists missing the newest
  documents.
- **`.gitkeep` scaffold files** no longer surface as documents in
  `changelog`.
- **README install threshold corrected:** npm 11+ blocks install
  scripts, not 12+. Also noted: upgraders from this tool's earlier name
  should remove the old skill directory.

### Changed

- **`batch --dry-run --json`** now returns the full per-op validation
  report (derived slugs, errors, warnings) instead of
  `{valid, operations: <count>}`.

## 1.1.1 — 2026-08-01

Docs release: the README now says what Hafez is for, not just what it is
made of. No code changes.

### Changed

- **README identity rewritten.** Hafez is a knowledge and project vault
  shared between you and your agents: humans have short-term context,
  agents have session context, and the vault is where both remember. The
  Why now explains the division of labor — agents write through a CLI
  that enforces the schema (a malformed write fails, links must
  resolve), so every agent treats the vault the same and spends its
  context on content, not conventions.
- **Data freedom stated explicitly.** `hafez export --okf` is now
  covered in the README's "files stay yours" paragraph, with a link to
  the OKF v0.1 spec — Hafez's schema is stricter than OKF's, so the
  export loses nothing.
- **npm package description and AGENTS.md** aligned to the same
  identity.

## 1.1.0 — 2026-08-01

First-run onboarding release: a fresh install now has a guided path from
empty vault to working memory loop, and the docs follow the AGENTS.md
standard so any agent harness can drive Hafez.

### Highlights

- **`hafez onboard`** — an agent-directed first-run guide in the same
  spirit as `help --agent`. It walks the agent through a seeding
  interview (3–7 real projects with descriptions, briefs, and next
  actions; anything vague becomes a capture, written in one `hafez
  batch`), then a choice of integration level: an always-active block
  for the harness's global instructions file, or invoke-only. An empty
  vault now points to it from `hafez stats`.
- **Any harness, one interface** — onboarding names both conventions:
  `~/.claude/CLAUDE.md` for Claude Code, and the harness's global
  AGENTS.md (e.g. `~/.codex/AGENTS.md`) for everything on the AGENTS.md
  standard. The bundled Claude Code skill is an optional adapter; the
  CLI is the whole interface.
- **AGENTS.md ships** — the repo now follows the AGENTS.md convention
  itself: `AGENTS.md` is the canonical agent doc and `CLAUDE.md` is a
  thin import of it, so the two can never drift.

### Fixed

- `npm run install:local` restores the executable bit on `dist/cli.js`
  before linking — a bare `npm run build` previously left the local
  symlink pointing at a non-executable file.

## 1.0.2 — 2026-07-31

Data-safety release. Every fix below was verified against a reproduction
before and after; the sync fixes were driven by a real multi-machine vault
that lost data to the old conflict path.

### Fixed

- **Sync no longer destroys unpushed local commits on conflict.** The old
  semantic merge did `git reset --hard origin` and re-applied only the
  conflicting files — any other unpushed commit was silently discarded while
  sync reported success. Conflicts are now resolved *inside* the
  `pull --rebase` (merged content is written, staged, and the rebase
  continues), so every non-conflicting commit survives. The conflict/retry
  machinery, previously triplicated across `gitSync` and `gitCommitAndPush`,
  is now one shared code path.
- **Concurrent hafez processes no longer lose writes.** The write mutex was
  in-process only; two CLIs (or a bot plus a CLI) racing on one vault could
  drop session-log entries with both reporting ok. Mutations and sync now
  take a vault-level cross-process lock (`.hafez.lock`, via proper-lockfile)
  with retry/backoff and stale-lock takeover. New error code `VAULT_LOCKED`.
- **Concurrent remote appends are no longer discarded on merge.** Merge
  policy is now: append-only sections (Session Log, Next Actions, Evidence,
  Sources) union with dedup; scalar fields and sections resolve
  newest-wins by `last-touched`, local on tie. Previously everything outside
  Session Log / Next Actions was silently "local wins".
- **Path traversal via slugs is rejected.** Slugs like `../../outside/note`
  could read, overwrite, or delete `.md` files outside the vault through
  `read`, `update`, `promote`, and friends. Slugs are now validated at the
  single path-resolution choke point (path separators, leading dots, and
  drive colons rejected — names with spaces or non-Latin characters, as a
  hand-edited Obsidian vault contains, still work, and `slugify` now keeps
  non-Latin letters instead of collapsing them to an empty slug). A failed
  entity→knowledge promote also no longer deletes the file it just restored.
- **Corrupt `.hafez.db` self-heals.** The recovery path never ran
  (better-sqlite3 defers file access past the constructor the catch was
  wrapping), so a truncated or garbage index file crashed every command
  permanently. Recovery now covers the real failure point and clears stale
  `-wal`/`-shm` files before rebuilding. The index is a disposable cache —
  nothing is lost.
- **`batch()` failures leave a consistent vault.** A commit-stage failure
  (e.g. a raced `.git/index.lock`) now rolls all batch file writes back to
  their originals; a push-stage failure keeps the local commit and the
  updated index, matching its "changes saved locally" contract.
- `npm test` builds `dist/` first, so CLI end-to-end tests can no longer
  pass against stale code.

### Removed

- The pre-1.0 vault migrations (`hafez migrate types|next-actions|knowledge-v2`)
  and the deprecated input shims: `hafez create inbox` (use `hafez capture`),
  `--next-action` (use `--add-action`), and the positional link relation
  (use `--relation`). No vault created by a released version needs any of them.
  Passing `--next-action` now fails loudly rather than being silently ignored.

## 1.0.1 — 2026-07-31

### Fixed

- README: the npm 12+ install line now includes `--allow-remote=root` —
  npm 12 disables URL-tarball fetches by default, so the documented command
  failed with `EALLOWREMOTE` before reaching the install-scripts step.

## 1.0.0 — 2026-07-31

First public release.

Hafez (حافظ, "the keeper") is an agent-native personal knowledge vault:
markdown files with YAML frontmatter as the source of truth, a SQLite FTS5
read index, and git for history and sync.

- `hafez` CLI: entities, projects, captures, knowledge notes, and session
  notes with create / read / update / query / search / link / promote ops
- `hafez batch` — atomic multi-op mutations from JSON on stdin, one commit
  and one push per batch
- `hafez digest` — turn end-of-session context into a batch payload
  (`echo '<json>' | hafez digest | hafez batch`)
- `hafez help --agent` and `hafez schema <op>` — machine-readable API
  reference generated at runtime from the live Zod schemas
- `createHafez()` — the same operations as a Node.js library
- Bundled Claude Code skill (`skill/SKILL.md`) covering the full session
  lifecycle: context loading, mid-session vault ops, session-end digest
