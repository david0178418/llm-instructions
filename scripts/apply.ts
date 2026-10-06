#!/usr/bin/env bun
/** Plan and deploy personal instructions and skill links without managing plugins. */
import {
	chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync,
	openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync,
	rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";

const ROOT = realpathSync(join(import.meta.dir, ".."));
const HARNESS_FILES = { claude: "CLAUDE.md", codex: "AGENTS.md", grok: "Agents.md" } as const;
type Harness = keyof typeof HARNESS_FILES;
type Snapshot =
	| { readonly kind: "file"; readonly content: Buffer }
	| { readonly kind: "link"; readonly target: string }
	| { readonly kind: "missing" | "other" };
type StateEntry =
	| { readonly kind: "instruction"; readonly content: string }
	| { readonly kind: "skill"; readonly target: string };
type Action = {
	readonly description: string;
	readonly path: string;
	readonly before: Snapshot;
	readonly after: Snapshot;
};
type JournalEntry = {
	readonly path: string;
	readonly before: Snapshot["kind"];
	readonly after: Snapshot["kind"];
	readonly backup?: string;
	readonly target?: string;
};

const isRecord = function (value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};
const isHarness = function (value: string): value is Harness {
	return value === "claude" || value === "codex" || value === "grok";
};
const missingPath = function (error: unknown): boolean {
	return isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
};
const fileStat = function (path: string) {
	try { return statSync(path); }
	catch (error) { if (missingPath(error)) return undefined; throw error; }
};
const snapshot = function (path: string): Snapshot {
	let stats;
	try { stats = lstatSync(path); }
	catch (error) { if (missingPath(error)) return { kind: "missing" }; throw error; }
	if (stats.isSymbolicLink()) return { kind: "link", target: readlinkSync(path) };
	if (stats.isFile()) return { kind: "file", content: readFileSync(path) };
	return { kind: "other" };
};
const sameSnapshot = function (first: Snapshot, second: Snapshot): boolean {
	if (first.kind !== second.kind) return false;
	if (first.kind === "file") return second.kind === "file" && first.content.equals(second.content);
	if (first.kind === "link") return second.kind === "link" && first.target === second.target;
	return true;
};
// Ownership is lexical: do not accept another link merely because it resolves
// to the same contents through an alias or a redirected source directory.
const linkTarget = function (path: string, target: string): string {
	return resolve(dirname(path), target);
};
const isInside = function (path: string, directory: string): boolean {
	const suffix = relative(directory, path);
	return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(".." + sep));
};
const canonicalDirectory = function (path: string): string {
	try { return realpathSync(path); }
	catch (error) {
		if (!missingPath(error)) throw error;
		const parent = dirname(path);
		if (parent === path) throw error;
		return join(canonicalDirectory(parent), basename(path));
	}
};
const expandPath = function (path: string): string {
	return resolve(path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
};
const instructionBytes = function (path: string, current: Snapshot): Buffer | undefined {
	if (current.kind === "file") return current.content;
	if (current.kind === "link" && fileStat(path)?.isFile()) return readFileSync(path);
	return undefined;
};
const decodeText = function (content: Buffer): string {
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
};
const renderInstructions = function (shared: Buffer, addendum: string): Buffer {
	const extra = fileStat(addendum)?.isFile() ? readFileSync(addendum) : Buffer.alloc(0);
	if (!extra.toString().trim()) return shared;
	return Buffer.concat([Buffer.from(decodeText(shared).replace(/[\r\n]+$/, "")), Buffer.from("\n\n"), extra]);
};
const parseToml = function (text: string): Record<string, unknown> {
	const parsed: unknown = Bun.TOML.parse(text);
	if (!isRecord(parsed)) throw new Error("Grok configuration must be a TOML table");
	return parsed;
};
const grokConfig = function (content: Buffer): Buffer {
	const text = decodeText(content);
	const parsed = parseToml(text);
	const section = /^\s*\[compat\.claude\]\s*(?:#.*)?$/;
	const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const starts = lines.flatMap(function (line, index) {
		return section.test(line.replace(/[\r\n]+$/, "")) ? [index] : [];
	});
	// Older Bun versions accept some repeated tables. Refuse ambiguous target
	// declarations even when the runtime parser merges their distinct keys.
	if (starts.length > 1) throw new Error("duplicate Grok compat.claude table; resolve it before applying");
	const compat = parsed.compat ?? {};
	if (!isRecord(compat)) throw new Error("Grok compat must be a table");
	const claude = compat.claude ?? {};
	if (!isRecord(claude)) throw new Error("Grok compat.claude must be a table");
	if (claude.agents === false) return content;
	// Edit ordinary table spelling conservatively; validate the exact semantic
	// change instead of reserializing and discarding comments and formatting.
	const start = starts[0] ?? -1;
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	let result: string;
	if (start >= 0) {
		const boundary = lines.findIndex(function (line, index) { return index > start && line.trimStart().startsWith("["); });
		const end = boundary < 0 ? lines.length : boundary;
		let replaced = false;
		for (let index = start + 1; index < end; index++) {
			const line = lines[index];
			if (line === undefined) throw new Error("invalid Grok line index");
			const match = /^(\s*agents\s*=\s*)(?:true|false)(\s*(?:#.*)?)$/.exec(line.replace(/[\r\n]+$/, ""));
			if (!match) continue;
			const prefix = match[1];
			const suffix = match[2];
			if (prefix === undefined || suffix === undefined) throw new Error("invalid Grok setting match");
			lines[index] = prefix + "false" + suffix + newline;
			replaced = true;
			break;
		}
		if (!replaced) {
			if (Object.hasOwn(claude, "agents")) throw new Error("unsupported Grok agents spelling; set compat.claude.agents = false manually");
			const heading = lines[start];
			if (heading === undefined) throw new Error("missing Grok table heading");
			if (!/[\r\n]$/.test(heading)) lines[start] = heading + newline;
			lines.splice(start + 1, 0, "agents = false" + newline);
		}
		result = lines.join("");
	} else {
		result = text + (text && !text.endsWith("\n") ? newline : "");
		result += newline + "[compat.claude]" + newline + "agents = false" + newline;
	}
	const wanted = { ...parsed, compat: { ...compat, claude: { ...claude, agents: false } } };
	if (!isDeepStrictEqual(parseToml(result), wanted)) {
		throw new Error("cannot safely edit this Grok TOML layout; set compat.claude.agents = false manually");
	}
	return Buffer.from(result);
};
const loadState = function (current: Snapshot): Map<string, StateEntry> {
	if (current.kind === "missing") return new Map();
	if (current.kind !== "file") throw new Error("deployment state must be a regular file");
	const value: unknown = JSON.parse(decodeText(current.content));
	if (!isRecord(value) || value.version !== 1) throw new Error("unsupported deployment state");
	if (!isRecord(value.entries)) throw new Error("invalid deployment state entries");
	const entries = new Map<string, StateEntry>();
	for (const [dest, entry] of Object.entries(value.entries)) {
		if (!isAbsolute(dest) || !isRecord(entry) || Object.keys(entry).length !== 2) throw new Error("invalid deployment state destination");
		if (entry.kind === "instruction" && typeof entry.content === "string") {
			entries.set(dest, { kind: "instruction", content: entry.content });
		} else if (entry.kind === "skill" && typeof entry.target === "string" && isAbsolute(entry.target)) {
			entries.set(dest, { kind: "skill", target: entry.target });
		} else {
			throw new Error("invalid deployment state entry");
		}
	}
	return entries;
};
const atomicWrite = function (path: string, content: Buffer, mode = 0o600): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), ".agent-config-" + crypto.randomUUID());
	const fd = openSync(temporary, "wx", 0o600);
	try {
		writeFileSync(fd, content);
		fsyncSync(fd);
		chmodSync(temporary, mode);
		closeSync(fd);
	} catch (error) {
		closeSync(fd);
		rmSync(temporary, { force: true });
		throw error;
	}
	try { renameSync(temporary, path); }
	finally { rmSync(temporary, { force: true }); }
};
const applyAction = function (action: Action): void {
	if (!sameSnapshot(snapshot(action.path), action.before)) throw new Error(`${action.path} changed after planning; rerun dry run`);
	if (action.after.kind === "file") {
		const stats = fileStat(action.path);
		const mode = stats?.isFile() ? stats.mode & 0o7777 : 0o600;
		atomicWrite(action.path, action.after.content, mode);
	} else if (action.after.kind === "link") {
		mkdirSync(dirname(action.path), { recursive: true });
		const temporary = join(dirname(action.path), ".agent-config-" + crypto.randomUUID());
		symlinkSync(action.after.target, temporary);
		try { renameSync(temporary, action.path); }
		finally { rmSync(temporary, { force: true }); }
	} else if (action.after.kind === "missing") {
		unlinkSync(action.path);
	} else {
		throw new Error("invalid deployment action");
	}
};
const printDiff = function (path: string, before: Buffer, after: Buffer): void {
	if (before.equals(after)) return;
	const oldLines = before.toString().match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const newLines = after.toString().match(/[^\n]*\n|[^\n]+$/g) ?? [];
	let prefix = 0;
	while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
	let suffix = 0;
	while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
		&& oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
	const start = Math.max(0, prefix - 3);
	const context = Math.min(3, suffix);
	const oldEnd = oldLines.length - suffix;
	const newEnd = newLines.length - suffix;
	const format = function (marker: string, line: string): string {
		return marker + line + (line.endsWith("\n") ? "" : "\n\\ No newline at end of file\n");
	};
	const range = function (end: number): string {
		const count = end + context - start;
		return `${count === 0 ? start : start + 1},${count}`;
	};
	console.log(`--- ${path}\n+++ ${path} (repository)\n@@ -${range(oldEnd)} +${range(newEnd)} @@`);
	process.stdout.write([
		...oldLines.slice(start, prefix).map(function (line) { return format(" ", line); }),
		...oldLines.slice(prefix, oldEnd).map(function (line) { return format("-", line); }),
		...newLines.slice(prefix, newEnd).map(function (line) { return format("+", line); }),
		...oldLines.slice(oldEnd, oldEnd + context).map(function (line) { return format(" ", line); }),
	].join(""));
};
const serializeState = function (entries: Map<string, StateEntry>): Buffer {
	return Buffer.from(JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }, null, 2) + "\n");
};
const writeBackups = function (actions: readonly Action[], statePath: string, stateBefore: Snapshot): void {
	const backupDir = join(dirname(statePath), "backups", new Date().toISOString().replace(/[-:.]/g, "") + "-" + crypto.randomUUID());
	// Print the recovery location before creating any files, including if a later
	// I/O failure interrupts this non-transactional run.
	console.log(`Recovery backups: ${backupDir}`);
	const journal: JournalEntry[] = actions.map(function (action, index) {
		const record = { path: action.path, before: action.before.kind, after: action.after.kind };
		if (action.before.kind === "file") {
			const backup = join(backupDir, `${index}.bak`);
			atomicWrite(backup, action.before.content);
			return { ...record, backup };
		}
		if (action.before.kind === "link") {
			if (fileStat(action.path)?.isFile()) {
				const backup = join(backupDir, `${index}.bak`);
				atomicWrite(backup, readFileSync(action.path));
				return { ...record, target: action.before.target, backup };
			}
			return { ...record, target: action.before.target };
		}
		return record;
	});
	if (stateBefore.kind === "file") atomicWrite(join(backupDir, "state.json.bak"), stateBefore.content);
	atomicWrite(join(backupDir, "journal.json"), Buffer.from(JSON.stringify(journal, null, 2) + "\n"));
};

const main = function (): number {
	const { values } = parseArgs({ args: process.argv.slice(2), options: {
		check: { type: "boolean" }, "dry-run": { type: "boolean", short: "n" },
		diff: { type: "boolean" }, help: { type: "boolean", short: "h" },
		harness: { type: "string", multiple: true }, "config-dir": { type: "string", multiple: true },
	} });
	if (values.help) {
		console.log("usage: apply.sh [--check | --dry-run] [--diff] [--harness claude|codex|grok] [--config-dir HARNESS=PATH]\n\nDetect configured harnesses by default; repeat --harness to select explicitly.\n--check exits 1 for pending changes or skipped instructions; --dry-run (-n) writes nothing.\n--diff includes content differences. Conflicts and errors exit 2.");
		return 0;
	}
	if (values.check && values["dry-run"]) throw new Error("--check and --dry-run are mutually exclusive");
	const selectedArguments: Harness[] = [];
	for (const name of values.harness ?? []) {
		if (!isHarness(name)) throw new Error(`unknown harness: ${name}`);
		if (!selectedArguments.includes(name)) selectedArguments.push(name);
	}
	const home = expandPath(process.env.AGENT_CONFIG_HOME ?? homedir());
	const dirs: Record<Harness, string> = { claude: join(home, ".claude"), codex: join(home, ".codex"), grok: join(home, ".grok") };
	if (process.env.AGENT_CONFIG_HOME === undefined) {
		if (process.env.CODEX_HOME) dirs.codex = expandPath(process.env.CODEX_HOME);
		if (process.env.CLAUDE_CONFIG_DIR) dirs.claude = expandPath(process.env.CLAUDE_CONFIG_DIR);
	}
	for (const override of values["config-dir"] ?? []) {
		const index = override.indexOf("=");
		const name = override.slice(0, index);
		const path = override.slice(index + 1);
		if (index < 0 || !isHarness(name) || !path) throw new Error("--config-dir must be claude=PATH, codex=PATH, or grok=PATH");
		dirs[name] = expandPath(path);
	}
	const harnesses: readonly Harness[] = ["claude", "codex", "grok"];
	const selected = selectedArguments.length ? selectedArguments : harnesses.filter(function (name) { return fileStat(dirs[name])?.isDirectory(); });
	console.log(`${selectedArguments.length ? "Selected" : "Detected"} harnesses: ${selected.join(", ") || "none"}`);
	if (!selected.length) {
		console.log("No changes: no configured harnesses detected. Use --harness to install explicitly.");
		return 0;
	}
	for (const name of selected) dirs[name] = canonicalDirectory(dirs[name]);
	if (new Set(selected.map(function (name) { return dirs[name]; })).size !== selected.length) throw new Error("selected harnesses must use distinct configuration directories");
	const statePath = join(home, ".local/state/agent-config/state.json");
	const stateBefore = snapshot(statePath);
	const entries = loadState(stateBefore);
	const nextEntries = new Map(entries);
	const actions: Action[] = [];
	const errors: string[] = [];
	const shared = readFileSync(join(ROOT, "instructions/user.md"));
	const skipped = !decodeText(shared).trim();
	if (skipped) console.log("Skipped instruction deployment: shared source is empty; addenda are also skipped.");
	const skillSources = join(ROOT, "skills");
	const skills = new Map<string, string>();
	if (snapshot(skillSources).kind === "link") {
		errors.push(`${skillSources}: source skill directory must be inside this repository`);
	} else if (existsSync(skillSources)) {
		for (const name of readdirSync(skillSources).sort()) {
			const source = join(skillSources, name);
			if (snapshot(source).kind === "link") errors.push(`${source}: source skill links are unsupported; keep custom skill directories in this repository`);
			else if (fileStat(join(source, "SKILL.md"))?.isFile()) skills.set(name, source);
		}
	}
	for (const name of selected) {
		const configDir = dirs[name];
		const instructionPath = join(configDir, HARNESS_FILES[name]);
		if (!skipped) {
			const desired = renderInstructions(shared, join(ROOT, `instructions/${name}.md`));
			const desiredText = decodeText(desired);
			const current = snapshot(instructionPath);
			const old = instructionBytes(instructionPath, current);
			const previous = entries.get(instructionPath);
			const repoLink = current.kind === "link" && isInside(linkTarget(instructionPath, current.target), join(ROOT, "instructions"));
			let conflict = current.kind === "other" || (current.kind === "link" && !repoLink);
			if (current.kind === "file" && !old?.equals(desired)) {
				conflict = previous?.kind !== "instruction" || !old?.equals(Buffer.from(previous.content));
			}
			if (repoLink && !old?.equals(desired)) conflict = true;
			if (conflict) {
				errors.push(`${instructionPath}: instruction contents differ locally or destination is not owned; compare/import before applying`);
				if (values.diff && old) printDiff(instructionPath, old, desired);
			} else {
				nextEntries.set(instructionPath, { kind: "instruction", content: desiredText });
				const after: Snapshot = { kind: "file", content: desired };
				if (!sameSnapshot(current, after)) {
					actions.push({ description: "write instructions", path: instructionPath, before: current, after });
					if (values.diff) printDiff(instructionPath, old ?? Buffer.alloc(0), desired);
				}
			}
		}
		const skillBase = join(configDir, "skills");
		if (snapshot(skillBase).kind === "link" || (existsSync(skillBase) && !fileStat(skillBase)?.isDirectory())) {
			errors.push(`${skillBase}: expected a real skill directory; refusing to modify it`);
			continue;
		}
		for (const [skillName, source] of skills) {
			const dest = join(skillBase, skillName);
			const current = snapshot(dest);
			const previous = entries.get(dest);
			const same = current.kind === "link" && linkTarget(dest, current.target) === source;
			const managed = current.kind === "link" && previous?.kind === "skill" && linkTarget(dest, current.target) === previous.target;
			if (current.kind !== "missing" && !same && !managed) {
				errors.push(`${dest}: existing skill is not a managed link; preserve/import it before applying`);
				continue;
			}
			nextEntries.set(dest, { kind: "skill", target: source });
			if (!same) actions.push({ description: "link skill", path: dest, before: current, after: { kind: "link", target: source } });
		}
		for (const [dest, entry] of entries) {
			if (entry.kind !== "skill" || dirname(dest) !== skillBase || skills.has(basename(dest))) continue;
			const current = snapshot(dest);
			if (current.kind === "missing") nextEntries.delete(dest);
			else if (current.kind === "link" && linkTarget(dest, current.target) === entry.target) {
				actions.push({ description: "remove obsolete skill link", path: dest, before: current, after: { kind: "missing" } });
				nextEntries.delete(dest);
			} else errors.push(`${dest}: obsolete managed link was changed locally; leaving it untouched`);
		}
		if (name === "grok" && !skipped) {
			const dest = join(configDir, "config.toml");
			const current = snapshot(dest);
			if (current.kind !== "file" && current.kind !== "missing") {
				errors.push(`${dest}: expected a regular Grok config file`);
				continue;
			}
			const content = current.kind === "file" ? current.content : Buffer.alloc(0);
			try {
				const desired = grokConfig(content);
				if (!desired.equals(content)) {
					actions.push({ description: "set Grok compat.claude.agents = false", path: dest, before: current, after: { kind: "file", content: desired } });
					if (values.diff) printDiff(dest, content, desired);
				}
			} catch (error) { errors.push(`${dest}: ${error instanceof Error ? error.message : String(error)}`); }
		}
	}
	const stateChanged = !isDeepStrictEqual(entries, nextEntries);
	for (const action of actions) console.log(`Would ${action.description}: ${action.path}`);
	if (stateChanged) console.log(`Would update deployment state: ${statePath}`);
	if (errors.length) {
		for (const error of errors) console.error("Conflict: " + error);
		console.error("No changes written.");
		return 2;
	}
	if (!actions.length && !stateChanged) console.log("No changes" + (skipped ? " to eligible files; instruction deployment remains skipped." : "; selected harnesses match this checkout."));
	if (values.check) return actions.length || stateChanged || skipped ? 1 : 0;
	if (values["dry-run"] || (!actions.length && !stateChanged)) return 0;
	if (!sameSnapshot(snapshot(statePath), stateBefore) || actions.some(function (action) { return !sameSnapshot(snapshot(action.path), action.before); })) {
		throw new Error("configuration changed after planning; nothing applied, rerun dry run");
	}
	writeBackups(actions, statePath, stateBefore);
	for (const action of actions) applyAction(action);
	atomicWrite(statePath, serializeState(nextEntries));
	console.log(`Applied ${actions.length} change(s).${skipped ? " Instruction deployment remains skipped." : ""}`);
	return 0;
};
try { process.exitCode = main(); }
catch (error) {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 2;
}
