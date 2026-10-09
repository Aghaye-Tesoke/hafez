Three renders from `hafez onboard`. Each fenced block is one complete output.

## `hafez onboard --block` (what the SessionStart hook prints)

The Block exactly as in `block.md`, then one line per entity matching the folder. The folder is the working directory, its git root, and, in a linked worktree, the main repository's root; each is matched exactly, and no directory in between is tried. No match: the Block alone.

````
<!-- hafez:begin 6adb94431f00 -->
(the Block)
<!-- hafez:end -->

This folder is a Hafez entity. Read it first:
hafez read auth-refactor (Move session handling from cookies to short-lived tokens)
````

Several matches, all printed, active first; an entity with no description gets its slug alone:

````
<!-- hafez:begin 6adb94431f00 -->
(the Block)
<!-- hafez:end -->

This folder matches several Hafez entities. Read the one that fits first:
hafez read auth-refactor (Move session handling from cookies to short-lived tokens)
hafez read session-tokens
````

## `hafez onboard` (status, then the script the agent follows)

````
# Hafez setup

You are an agent reading this for your user. Talk them through it; do not paste this to them.

## Where things stand

Vault: /home/ana/vault (6 entities, 3 knowledge notes)
Claude Code (this harness): Block absent | skills absent | hook absent | allowlist absent
Codex (found at ~/.codex): Block absent | skills absent

## 1. Ask how Hafez should run

Ask one question and recommend the first answer.

- Always-on: you load the vault at the start of a session and write to it as work lands.
- Invoke-only: nothing happens unless the user asks. No load at start, no writes during the session.

## 2. Install

Always-on: show the user the Block below word for word, not a summary, say it goes into ~/.claude/CLAUDE.md between two marker lines and nothing else in that file changes, and get a yes. Then run:

hafez onboard --install --mode always-on

Invoke-only: no file of theirs is edited. Run:

hafez onboard --install --mode invoke-only

Both install two skills, `hafez` and `hafez-save`, into ~/.claude/skills and ~/.agents/skills.

(the Block)

## 3. Allow the command

A permission prompt on a hafez command means setup is unfinished. Show the user this entry, then add it to ~/.claude/settings.json under permissions.allow:

"Bash(hafez:*)"

## 4. Offer the session-start hook (always-on only)

Ask: should the Block be delivered again at the start of every session and after the context is compacted? If yes, show this entry, then add it to ~/.claude/settings.json under hooks.SessionStart:

{"matcher": "startup|compact", "hooks": [{"type": "command", "command": "hafez onboard --block --harness claude-code"}]}

## 5. Offer the other harness

Codex is installed too. Ask once whether to set it up the same way. If yes:

hafez onboard --install --harness codex --mode always-on

## 6. Seed the vault (skipped: the vault is not empty)

## 7. Hand over

Say these to the user in your own words, then give three example asks drawn from their vault, each naming an entity or note in it.

(the teaching lines)
````

Step 6 on an empty vault:

````
## 6. Seed the vault

An empty vault gives you nothing to load. Ask: "What are you working on right now?" Aim for three to seven pieces of work. For each, draw out one sentence of description, where things stand, and the next step, then write it:

hafez create entity "<name>" --type <project|entity> --description "<one sentence>" --brief "<where things stand>" --add-action "<next step>"

Anything vague or someday: `hafez capture "<name>"`. Read a README or notes only if the user points you at them. Do not ask for approval before writing. When done, show them `hafez stats`.
````

## Teaching lines

Line 1 carries the keystroke of the harness `onboard` ran in: `/hafez-save` on Claude Code, `$hafez-save` on Codex. The Block names the skill and never the keystroke, because one instruction file can serve two harnesses.

Always-on:

```
1. Nothing saves itself. Run /hafez-save before you end a session.
2. Hafez is always on: the agent loads your work at the start of a session and writes to the vault as work lands.
3. The agent writes without asking and tells you in one line. Every write is a git commit, so any of them can be undone.
4. If a hafez command ever asks for permission, setup is unfinished: run `hafez onboard` again.
```

Invoke-only, line 2:

```
2. Hafez is invoke-only: nothing is loaded and nothing is written unless you ask. Say "read <name>" to load, "note this" to write.
```
