# agent-config

Personal global instructions and custom skills for Claude Code, Codex, and Grok on Linux and macOS. Git distributes the source files; `apply.sh` deploys a local checkout. Native marketplace plugins remain independently managed by each application.

## Requirements

- Bash (including macOS's bundled Bash).
- Bun 1.3.14 or newer. Deployment uses only built-in Bun/Node APIs; no package installation is needed to apply configuration.
- Git for cloning and updating the repository.

Python and a separate Node executable are not required. `apply.sh` launches the TypeScript implementation with Bun. You can also use `bun run apply` with the same arguments, for example `bun run apply --dry-run --diff`.

## First setup

Install your chosen applications and their native marketplace plugins normally, then clone this repository:

```bash
git clone <repository-url> ~/agent-config
cd ~/agent-config
./apply.sh --dry-run --diff
./apply.sh
./apply.sh --check
```

With no `--harness` arguments, the script detects existing configuration directories and prints the selection. This means configured on this machine, not currently running. A leftover directory from an uninstalled application can still be detected. With none detected, nothing is written.

For a new configuration directory, or to restrict deployment, select harnesses explicitly:

```bash
./apply.sh --harness codex --harness claude --dry-run --diff
./apply.sh --harness codex --harness claude
./apply.sh --harness codex --harness claude --check
```

Explicit selection targets exactly those harnesses, including creating their configuration directories when necessary. Start a new application session after applying changes.

## Source layout

```text
instructions/user.md       shared global instructions
instructions/claude.md     optional Claude Code addendum
instructions/codex.md      optional Codex addendum
instructions/grok.md       optional Grok addendum
skills/<name>/SKILL.md     custom skills, including supporting files
apply.sh                   portable shell entry point
scripts/apply.ts           planner and deployment implementation
```

Edit instructions and skills in this repository, then commit and push them to distribute updates. Instruction text is data; applying it does not authorize changing its wording.

For each selected harness, the script copies shared instructions followed by a non-empty harness addendum into its global instruction file. Instructions are regular files, not symlinks. An empty or whitespace-only shared source skips all instruction deployment, including addenda and the Grok instruction-compatibility setting, preserving existing instruction files and sources. Custom skill deployment can still proceed.

| Harness | Default instruction destination | Default custom skill directory |
| --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills/` |
| Codex | `~/.codex/AGENTS.md` | `~/.agents/skills/` |
| Grok | `~/.grok/Agents.md` | `~/.grok/skills/` |

Each custom skill directory is linked individually. Store source skill directories directly in this repository; symlinked source directories are rejected. Adding or renaming a skill requires applying again; edits inside an already-linked skill are visible directly through its link. Recorded obsolete links are removed only when their normalized link paths still match the recorded targets. Changed links block application rather than being deleted, even when they resolve to the same contents through another symlink.

These are native personal discovery locations: [Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills), [Claude Code](https://code.claude.com/docs/en/skills#choose-where-skills-load), and [Grok Build](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/08-skills.md). The global instructions describe when to use a skill; they do not prescribe path searches or discovery fallbacks.

When upgrading from the old Codex destination, application first plans links in `~/.agents/skills/` and removal of recorded links under the selected Codex configuration's `skills/` directory. Only unchanged links recorded in deployment state are removed. Untracked links, `.system`, native plugins, and unrelated files remain untouched. A changed legacy link, redirected legacy directory, or collision at the native destination blocks all changes. Dry run reports the migration before it is applied.

For selected Grok configurations, the script sets the boolean `[compat.claude] agents = false` in `config.toml` to avoid loading the shared global policy twice through Claude compatibility. It validates TOML before and after the edit and preserves unrelated values and formatting. Unusual valid layouts that cannot be safely edited are reported as conflicts; set that flag manually in those cases. This setting concerns instruction compatibility, not plugin installation.

## Updates and preview

```bash
git pull --ff-only
./apply.sh --dry-run --diff
./apply.sh
./apply.sh --check
```

Pulling alone does not update copied instruction files. The script never fetches, pulls, commits, or pushes. `--check` compares the machine against this local checkout, not the remote repository.

`--dry-run` reports instruction writes, skill links and removals, Grok settings, state changes, conflicts, and skipped instruction deployment. It creates no destination directories, backups, or state. `--diff` includes instruction and configuration content differences; use it only where displaying those contents is appropriate. Dry run, check, and apply share the same planning logic.

| Exit | Meaning |
| --- | --- |
| `0` | Apply completed, dry run found no blocking conflicts, or check found a complete match |
| `1` | Check found pending changes or instruction deployment was skipped |
| `2` | Conflict, invalid arguments/configuration, or an I/O error |

A dry run can exit `0` while reporting pending changes. An empty shared source is a no-op for instructions, but `--check` exits `1` so it does not claim those files are synchronized. If no harnesses are detected, the script exits `0` with an explicit no-changes notice.

## Existing configurations and local edits

Before initial deployment, compare existing global instruction files across your harnesses. Import their common content into `instructions/user.md` and their differences into the corresponding addenda. The script accepts a pre-existing regular instruction file only when it matches the assembled source. Existing links into this repository's instruction directory can also be converted when their contents match; links elsewhere are left alone and reported as conflicts.

Existing custom skill directories are never replaced, even when their contents match. Copy the intended custom skill into this repository, compare it, and move the original directory to a backup location outside the active skill directory before applying. Do not import marketplace plugin directories or application-provided skills.

After installation, the script records the last applied instruction contents and each managed skill destination. Locally edited instruction files block overwrites. Resolve by incorporating the intended edits into the canonical sources so the assembled content matches, or by restoring the last applied destination content from a backup. Then dry-run again. There is no force-overwrite option.

The state and recovery backups live under:

```text
~/.local/state/agent-config/state.json
~/.local/state/agent-config/backups/<timestamp>/
```

Retain deployment state: it establishes ownership for updates and stale-link cleanup. The version-1 JSON state format is unchanged from the Python implementation; no migration or fresh installation is required. On every changing run, a recovery journal records the affected destinations, prior symlink targets, and backups of replaced file contents and previous state. Before manual restoration, inspect the journal and current destinations; restore only the entries from the affected run. For newly created destinations, the journal records that they were previously missing. To restore a converted instruction symlink, its prior target and a content backup are both recorded.

All planned conflicts are checked before deployment. File replacement is atomic, but the whole run is not a transaction: an I/O failure or concurrent edit during application can leave a partial deployment. Use the printed backup directory to recover, then rerun the preview. Concurrent deployments should be avoided.

## Custom paths

`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `GROK_HOME` override their harness configuration directories when set. Use repeatable `--config-dir` arguments for other locations or explicit overrides:

```bash
./apply.sh --config-dir codex=/path/to/codex --dry-run
./apply.sh --harness grok --config-dir grok=/path/to/grok
```

A path override participates in detection but does not select the harness by itself. Use `--harness` when the directory does not exist yet. Repeat the same overrides for subsequent runs. Selected harnesses must use distinct configuration directories.

Claude and Grok personal skill destinations follow their selected configuration directories. Codex personal skills stay under `~/.agents/skills/`, independently of `CODEX_HOME` or `--config-dir codex=...`. For an explicitly configured alternative skill directory, use `--skills-dir HARNESS=PATH`:

```bash
./apply.sh --harness codex --skills-dir codex=/path/to/personal-skills --dry-run
```

This deployment override does not configure the harness to discover that alternate directory. Use native defaults unless the harness is separately configured for the alternative. Repeat overrides on future runs. Changes to custom skill directories preserve managed links outside the currently selected destinations; automatic migration is limited to the legacy Codex configuration-directory path.

`AGENT_CONFIG_HOME` redirects the default home paths and deployment state, primarily for isolated tests. When set, it also suppresses inherited `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `GROK_HOME`; explicit path arguments still work.

## Native plugins and unrelated files

The script does not install, update, register, or uninstall plugins. It does not read or write marketplace manifests, plugin installations/caches, authentication, sessions, history, or memory. It preserves unrelated skills and application-managed directories such as `.system`. A custom skill naming collision blocks the entire run rather than overwriting existing content. A symlinked whole skill directory also blocks application.

## Validation

```bash
bash -n apply.sh
bun install --frozen-lockfile
bun run check
```

`bun run check` runs the strict TypeScript typecheck and Bun's integration tests. Only development checks require the packages in `devDependencies`; deployment works without `node_modules`.

The tests use temporary repositories and home directories, including coverage for version-1 deployment-state compatibility and execution without Python or installed packages. CI runs typechecking and the deployment suite on Linux and macOS with Bun 1.3.14 and the latest stable Bun. Tests validate filesystem behavior; application-specific discovery of instructions and skills should also be checked in a fresh session on each environment.
