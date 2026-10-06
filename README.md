# agent-config

Personal global instructions and skills for Claude Code, Codex, and Grok. This repository is the source of truth. `apply.sh` points each application at it with symlinks.

Run `apply.sh` on a new machine, and again when a skill is added or an application path changes. `git pull` updates instruction text while an application's link points at `instructions/user.md`. A non-empty addendum is copied into `instructions/.rendered/`, so run `apply.sh` again after changing `user.md` or that addendum.

## Layout

```text
instructions/user.md       shared global instructions
instructions/claude.md     optional text appended for Claude Code
instructions/codex.md      optional text appended for Codex
instructions/grok.md       optional text appended for Grok
skills/<name>/SKILL.md     one skill directory per skill
plugins.toml               plugin names to install later
machines/<hostname>.toml   per-machine paths, unused by apply.sh
apply.sh                   creates the links and the Grok flag below
```

`plugins.toml` and `machines/` are part of the shape. `apply.sh` does not install plugins and does not read machine files.

## Instructions

| Application | Path `apply.sh` links |
| --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| Grok | `~/.grok/Agents.md` |

An empty addendum file makes that application's link point at `instructions/user.md`. A non-empty addendum is appended after `user.md` into `instructions/.rendered/<app>.md`, and that application's link points at the rendered file. `.rendered/` is generated and gitignored.

`apply.sh` sets this in `~/.grok/config.toml`:

```toml
[compat.claude]
agents = false
```

Grok then reads `~/.grok/Agents.md` and does not also read `~/.claude/CLAUDE.md`. Grok still reads a `CLAUDE.md` or `AGENTS.md` sitting in a project directory. With this flag off, Grok does not read `<project>/.claude/CLAUDE.md`.

## Skills

Each `skills/<name>/` directory that contains `SKILL.md` is linked to the same path under all three of these directories:

- `~/.claude/skills/<name>`
- `~/.codex/skills/<name>`
- `~/.grok/skills/<name>`

The script links those names individually. A directory such as `~/.codex/skills/.system` stays in place. Grok can discover the same skill through more than one of these links and keeps one copy by name.

## Safety

`apply.sh` writes nothing when any planned instruction or skill link is blocked. A block is a regular file whose contents differ from the repo, or a symlink that points outside this repo. Compare the live file with the repo file, update `instructions/user.md` or the skill, then run `apply.sh` again.

The script does not read or write auth, sessions, history, memory, or plugin caches.

Set `AGENT_CONFIG_HOME` to apply into a different home directory.

```bash
./apply.sh --check     # exit 0 when the home directory matches
./apply.sh --dry-run   # print actions and write nothing
./apply.sh             # create links
```

Exit `0` means the home directory matches or the links were written. Exit `1` from `--check` means a change is pending. Exit `2` means a live file blocked the run and nothing was written.

## Asking an agent

`skills/sync-agent-config/SKILL.md` tells an agent to run this script and to stop when it exits `2`. The instruction files are data. Syncing them does not include editing their wording.
