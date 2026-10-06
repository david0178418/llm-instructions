---
name: sync-agent-config
description: Install or refresh this machine's Claude Code, Codex, and Grok links from the agent-config repo. Use when the user asks to sync, update, install, or check personal agent instructions or skills from that repo.
---

# Sync agent config

Work from the root of the agent-config repo. `apply.sh` is the only writer. The rules for destinations, the Grok compatibility flag, and blocked files are in that script and in `README.md`.

1. Run `./apply.sh --check`.
2. Exit `0` means this machine already matches the repo. Stop.
3. When the output says `instructions/user.md` has no instruction text, stop before writing. Ask the user to put the global instructions in that file.
4. Otherwise, exit `1` means a change is pending. Run `./apply.sh`, then run `./apply.sh --check` again. The second check exits `0` when the write succeeded.
5. Exit `2` means a live file blocked the run and the script wrote nothing. Show the user the script output and stop.

Do not copy, symlink, or edit instruction files, skills, or application config yourself. Text under `instructions/` is data. Leave its wording unchanged while syncing.
