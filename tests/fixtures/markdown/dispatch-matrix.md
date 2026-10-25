## Synthesis

Three CLI agent platforms (Claude Code, Gemini CLI, Codex CLI) can all be dispatched programmatically from a universal dispatcher, but each has fundamentally different invocation patterns, approval models, and gotchas. The dispatch matrix below is the Rosetta Stone for launching any agent from any context.

### The Matrix

| Dimension | Claude Code (`claude`) | Gemini CLI (`gemini`) | Codex CLI (`codex`) |
|---|---|---|---|
| **Interactive dispatch** | `claude "prompt"` or stdin heredoc | `gemini -i "prompt"` | `codex "prompt"` |
| **Headless dispatch** | `claude -p "prompt"` | `gemini -p "prompt"` | `codex exec "prompt"` |
| **Full auto-approve** | `--permission-mode bypassPermissions` | `-y` or `--approval-mode yolo` | `-c 'approval_policy="never"'` + `-s workspace-write` |
| **Safe auto (edits only)** | `--permission-mode acceptEdits` | `--approval-mode auto_edit` | `--full-auto` (workspace-write + on-request) |
| **Read-only/plan** | `--permission-mode plan` | `--approval-mode plan` | `-s read-only` |
| **Default best model** | `opus[1m]` | `gemini-2.5-pro` (→ latest) | `gpt-5.4` |
| **Deep coding model** | `opus[1m]` | same | `gpt-5.3-codex` |
| **Model flag** | `--model` | `-m` | `-m` |
| **Extra directories** | `--add-dir /path` | `--include-directories /path` | `--add-dir /path` |
| **Working directory** | `cd` in launcher script | `cd` in launcher script | `-C /path` (native flag) |
| **Sandbox control** | `--settings '{"sandbox":...}'` | `-s` boolean flag | `-s workspace-write\|read-only\|danger-full-access` |
| **Config file** | `CLAUDE.md` | `GEMINI.md` | `AGENTS.md` |
| **Prompt via stdin** | `claude <<'EOF'` or `claude -p < file` | `echo "..." \| gemini -p` | `echo "..." \| codex exec -` |
| **Session resume** | `claude -c` / `claude -r` | `gemini -r` | `codex resume --last` |
| **Tab stays alive** | Yes (without `-p`) | Yes (with `-i`, NOT `-p`) | Yes (without `exec`) |
| **Output capture** | `--output-format json\|text\|stream-json` | `-o json\|text\|stream-json` | `--json` (JSONL) + `-o file` (last msg only) |
| **Key gotcha** | `[1m]` suffix mandatory for 1M context | `-p` = headless (blank terminal), must use `-i` for tabs | `exec` rejects `-a` flag; use `-c 'approval_policy="never"'` |

### Model Selection Policy

Always dispatch the highest quality model available. Token efficiency is irrelevant for third-party CLIs — the cost of a suboptimal answer far exceeds the token savings.

- **Claude Code**: `opus[1m]` always. `[1m]` suffix is mandatory — without it, defaults to 200K context.
- **Gemini**: Latest flagship (currently `gemini-2.5-pro`, moving to `gemini-3.1-pro`). Update as new models ship.
- **Codex**: `gpt-5.4` for general tasks. `gpt-5.3-codex` for deep coding (optimized for code generation). Never rely on implicit model defaults — always pass `-m` explicitly.

## Related

- [[fleet-orchestration-loop]]
- [[agent-fleet]]
