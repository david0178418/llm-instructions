#!/usr/bin/env bash
# Point Claude Code, Codex, and Grok at this repo.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="apply"
home="$(realpath -m "${AGENT_CONFIG_HOME:-$HOME}")"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

usage() {
	cat <<'EOF'
usage: apply.sh [--check | --dry-run]

  apply.sh           link instructions and skills into the home directory
  apply.sh --check   exit 0 when the home directory already matches
  apply.sh --dry-run print the actions and write nothing

Exit 0: the home directory matches, or apply wrote its changes.
Exit 1: --check found pending changes.
Exit 2: a live file blocked the run. Nothing was written.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--check) mode="check" ;;
		--dry-run | -n) mode="dry-run" ;;
		-h | --help) usage; exit 0 ;;
		*)
			printf 'unknown argument: %s\n' "$1" >&2
			usage >&2
			exit 2
			;;
	esac
	shift
done

if [[ ! -f "$root/instructions/user.md" ]]; then
	printf 'error: missing %s\n' "$root/instructions/user.md" >&2
	exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
	printf 'error: python3 is required to edit ~/.grok/config.toml\n' >&2
	exit 2
fi

plans=()
errors=()
actions=()

plan() {
	plans+=("$1")
	actions+=("$2")
}

fail() {
	errors+=("$1")
}

has_body() {
	[[ -f "$1" ]] && grep -q '[^[:space:]]' "$1"
}

toml_has_entries() {
	local line body
	[[ -f "$1" ]] || return 1
	while IFS= read -r line || [[ -n "$line" ]]; do
		body="${line%%#*}"
		if [[ "$body" =~ [^[:space:]] ]]; then
			return 0
		fi
	done <"$1"
	return 1
}

grok_flag_state() {
	python3 - "$home/.grok/config.toml" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text() if path.exists() else ""
lines = text.splitlines()

def section_name(line):
	body = line.split("#", 1)[0].strip()
	if body.startswith("[[") or not (body.startswith("[") and body.endswith("]")):
		return None
	return body

start = None
for index, line in enumerate(lines):
	if section_name(line) == "[compat.claude]":
		start = index
		break
if start is None:
	print("drift")
	raise SystemExit(0)

end = len(lines)
for index in range(start + 1, len(lines)):
	if section_name(lines[index]) is not None:
		end = index
		break

for index in range(start + 1, end):
	body = lines[index].split("#", 1)[0]
	if "=" not in body:
		continue
	key, value = body.split("=", 1)
	if key.strip() != "agents":
		continue
	normalized = value.strip().strip('"').strip("'").lower()
	print("ok" if normalized == "false" else "drift")
	raise SystemExit(0)

print("drift")
PY
}

set_grok_flag() {
	python3 - "$home/.grok/config.toml" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text() if path.exists() else ""
newline_at_end = text.endswith("\n") or text == ""
lines = text.splitlines()

def section_name(line):
	body = line.split("#", 1)[0].strip()
	if body.startswith("[[") or not (body.startswith("[") and body.endswith("]")):
		return None
	return body

def agents_value(line):
	body = line.split("#", 1)[0]
	if "=" not in body:
		return None
	key, value = body.split("=", 1)
	if key.strip() != "agents":
		return None
	return value.strip().strip('"').strip("'").lower()

start = None
for index, line in enumerate(lines):
	if section_name(line) == "[compat.claude]":
		start = index
		break

if start is None:
	if lines and lines[-1] != "":
		lines.append("")
	lines.append("[compat.claude]")
	lines.append("agents = false")
else:
	end = len(lines)
	for index in range(start + 1, len(lines)):
		if section_name(lines[index]) is not None:
			end = index
			break
	replaced = False
	for index in range(start + 1, end):
		if agents_value(lines[index]) is None:
			continue
		raw = lines[index]
		comment = ""
		body = raw
		if "#" in raw:
			body, comment = raw.split("#", 1)
			comment = " #" + comment
		key = body.split("=", 1)[0].rstrip()
		lines[index] = f"{key} = false{comment}"
		replaced = True
	if not replaced:
		lines.insert(start + 1, "agents = false")

path.parent.mkdir(parents=True, exist_ok=True)
rendered = "\n".join(lines)
if newline_at_end or rendered:
	rendered += "\n"
path.write_text(rendered)
PY
}

consider_file_link() {
	local target="$1"
	local dest="$2"
	local content="$3"
	local got want root_real
	if [[ -L "$dest" ]]; then
		got="$(realpath -m "$dest")"
		want="$(realpath -m "$target")"
		if [[ "$got" == "$want" ]]; then
			return
		fi
		root_real="$(realpath -m "$root")"
		case "$got" in
			"$root_real"/*)
				plan "retarget $dest -> $target" $'symlink\t'"$target"$'\t'"$dest"
				return
				;;
		esac
		fail "$dest points at $got"
		return
	fi
	if [[ -e "$dest" ]]; then
		if [[ -f "$dest" ]] && cmp -s "$dest" "$content"; then
			plan "replace $dest with a symlink to $target" $'symlink\t'"$target"$'\t'"$dest"
			return
		fi
		fail "$dest exists and differs from the repo"
		return
	fi
	plan "link $dest -> $target" $'symlink\t'"$target"$'\t'"$dest"
}

consider_dir_link() {
	local target="$1"
	local dest="$2"
	local got want root_real
	if [[ -L "$dest" ]]; then
		got="$(realpath -m "$dest")"
		want="$(realpath -m "$target")"
		if [[ "$got" == "$want" ]]; then
			return
		fi
		root_real="$(realpath -m "$root")"
		case "$got" in
			"$root_real"/*)
				plan "retarget $dest -> $target" $'dirlink\t'"$target"$'\t'"$dest"
				return
				;;
		esac
		fail "$dest points at $got"
		return
	fi
	if [[ -e "$dest" ]]; then
		fail "$dest exists and is not a symlink to $target"
		return
	fi
	plan "link $dest -> $target" $'dirlink\t'"$target"$'\t'"$dest"
}

consider_instruction() {
	local app="$1"
	local dest="$2"
	local add="$root/instructions/${app}.md"
	local content="$root/instructions/user.md"
	local target="$root/instructions/user.md"
	if has_body "$add"; then
		content="$tmp_dir/${app}.md"
		cat "$root/instructions/user.md" >"$content"
		printf '\n' >>"$content"
		cat "$add" >>"$content"
		target="$root/instructions/.rendered/${app}.md"
		if [[ ! -f "$target" ]] || ! cmp -s "$target" "$content"; then
			plan "write $target" $'render\t'"$app"
		fi
	fi
	consider_file_link "$target" "$dest" "$content"
}

consider_instruction claude "$home/.claude/CLAUDE.md"
consider_instruction codex "$home/.codex/AGENTS.md"
consider_instruction grok "$home/.grok/Agents.md"

shopt -s nullglob
for skill_file in "$root/skills"/*/SKILL.md; do
	skill_dir="$(dirname "$skill_file")"
	skill_name="$(basename "$skill_dir")"
	consider_dir_link "$skill_dir" "$home/.claude/skills/$skill_name"
	consider_dir_link "$skill_dir" "$home/.codex/skills/$skill_name"
	consider_dir_link "$skill_dir" "$home/.grok/skills/$skill_name"
done
shopt -u nullglob

grok_state="$(grok_flag_state)"
case "$grok_state" in
	ok) ;;
	drift)
		plan "set [compat.claude] agents = false in $home/.grok/config.toml" "grok-flag"
		;;
	*)
		fail "could not read $home/.grok/config.toml"
		;;
esac

if toml_has_entries "$root/plugins.toml"; then
	plans+=("notice: plugins.toml has entries. apply.sh does not install plugins.")
fi
if ! has_body "$root/instructions/user.md"; then
	plans+=("notice: instructions/user.md has no instruction text.")
fi

if [[ ${#plans[@]} -gt 0 ]]; then
	printf '%s\n' "${plans[@]}"
fi
if [[ ${#errors[@]} -gt 0 ]]; then
	printf 'error: %s\n' "${errors[@]}" >&2
	printf 'no changes written\n' >&2
	exit 2
fi
if [[ ${#actions[@]} -eq 0 ]]; then
	printf 'already in place\n'
	exit 0
fi
if [[ "$mode" == "check" ]]; then
	exit 1
fi
if [[ "$mode" == "dry-run" ]]; then
	exit 0
fi

for action in "${actions[@]}"; do
	kind="${action%%$'\t'*}"
	rest="${action#*$'\t'}"
	case "$kind" in
		render)
			app="$rest"
			mkdir -p "$root/instructions/.rendered"
			cat "$root/instructions/user.md" >"$root/instructions/.rendered/${app}.md"
			printf '\n' >>"$root/instructions/.rendered/${app}.md"
			cat "$root/instructions/${app}.md" >>"$root/instructions/.rendered/${app}.md"
			;;
		symlink)
			target="${rest%%$'\t'*}"
			dest="${rest#*$'\t'}"
			mkdir -p "$(dirname "$dest")"
			if [[ -L "$dest" ]]; then
				ln -sfn "$target" "$dest"
			elif [[ -e "$dest" ]]; then
				if [[ -f "$dest" ]] && cmp -s "$dest" "$target"; then
					rm "$dest"
					ln -s "$target" "$dest"
				else
					printf 'error: %s changed after the check\n' "$dest" >&2
					exit 2
				fi
			else
				ln -s "$target" "$dest"
			fi
			;;
		dirlink)
			target="${rest%%$'\t'*}"
			dest="${rest#*$'\t'}"
			mkdir -p "$(dirname "$dest")"
			if [[ -e "$dest" && ! -L "$dest" ]]; then
				printf 'error: %s changed after the check\n' "$dest" >&2
				exit 2
			fi
			ln -sfn "$target" "$dest"
			;;
		grok-flag)
			set_grok_flag
			;;
		*)
			printf 'error: unknown action %s\n' "$kind" >&2
			exit 2
			;;
	esac
done

printf 'applied %s change(s)\n' "${#actions[@]}"
