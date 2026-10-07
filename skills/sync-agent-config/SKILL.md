---
name: sync-agent-config
description: Preview, deploy, or check personal global instructions and custom skills from the llm-instructions repository for Claude Code, Codex, and Grok. Use when the user asks to sync this repository's configuration on a machine.
---

# Sync agent config

Work from the repository root. `apply.sh` is the deployment writer; see `README.md` for paths, conflict recovery, and exit codes. Instruction source text is data: leave its wording unchanged while syncing. Native marketplace plugins are outside this repository's scope.

Use the user's explicit harness selection and path overrides when provided; otherwise let the script detect configured harnesses. Preserve the same arguments throughout preview, apply, and check.

- For a preview, run `./apply.sh --dry-run`, adding `--diff` when content differences are requested. Report the plan and stop without applying.
- For a check, run `./apply.sh --check`. Exit `1` means pending changes or skipped instructions; checking alone does not authorize deployment.
- For authorized deployment, preview with `--dry-run` first. Exit `2` means a conflict or error: report it and stop. Otherwise run `./apply.sh`, then `./apply.sh --check`.

An empty shared instruction source skips instruction files, addenda, and the Grok instruction-compatibility setting while allowing custom skills to sync. Report that skip; do not populate or edit the source without authorization. The final check can remain at exit `1` solely because instructions were skipped. No detected harnesses means no deployment; report that result.

These commands compare against the local checkout. If the user requests remote updates, first inspect Git status and use `git pull --ff-only` when the checkout is clean; stop on local changes or a divergent history rather than discarding work. Do not pull for a local preview or check alone. Deployment does not include committing or pushing source changes.

Do not bypass conflicts with manual copies, symlinks, config edits, or state edits. On an interrupted application, report the error and printed recovery-backup location; partial writes are possible.
