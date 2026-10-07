import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
	readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync,
	unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const SOURCE = realpathSync(join(import.meta.dir, ".."));
class Fixture {
	readonly base = realpathSync(mkdtempSync(join(tmpdir(), "agent-config-test-")));
	readonly repo = join(this.base, "repo with spaces");
	readonly home = join(this.base, "home");
	readonly shared = join(this.repo, "instructions/user.md");
	readonly env: NodeJS.ProcessEnv = { ...process.env, AGENT_CONFIG_HOME: this.home };
	constructor() {
		mkdirSync(this.repo);
		for (const path of ["apply.sh", "scripts/apply.ts", "instructions", "skills", "package.json"]) {
			cpSync(join(SOURCE, path), join(this.repo, path), { recursive: true });
		}
		writeFileSync(this.shared, "Shared instructions.\n");
	}
	run(args: readonly string[] = [], code = 0, preload?: string) {
		const command = preload === undefined ? ["/bin/bash", join(this.repo, "apply.sh"), ...args]
			: [process.execPath, "--preload", preload, join(this.repo, "scripts/apply.ts"), ...args];
		const result = Bun.spawnSync(command, { env: this.env });
		const stdout = result.stdout.toString();
		const stderr = result.stderr.toString();
		expect(result.exitCode, stdout + stderr).toBe(code);
		return { stdout, stderr };
	}
	tree(): Map<string, string> {
		const entries = new Map<string, string>();
		// Include relative paths, contents, permissions, and links; never follow
		// links into a pre-existing or marketplace-owned directory.
		const home = this.home;
		const visit = function (directory: string): void {
			for (const name of readdirSync(directory).sort()) {
				const path = join(directory, name);
				const stats = lstatSync(path);
				const key = relative(home, path);
				if (stats.isSymbolicLink()) entries.set(key, "link:" + readlinkSync(path));
				else if (stats.isFile()) entries.set(key, `file:${stats.mode & 0o7777}:` + readFileSync(path).toString("base64"));
				else { entries.set(key, "directory"); visit(path); }
			}
		};
		if (existsSync(this.home)) visit(this.home);
		return entries;
	}
	write(path: string, content: string): void {
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}
}
let fixture: Fixture;
beforeEach(function () { fixture = new Fixture(); });
afterEach(function () { rmSync(fixture.base, { recursive: true, force: true }); });

const isLink = function (path: string): boolean {
	return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
};
const expectAbsent = function (path: string): void {
	expect(lstatSync(path, { throwIfNoEntry: false })).toBeUndefined();
};
type RecoveryRecord = {
	readonly path: string;
	readonly before: string;
	readonly after: string;
	readonly backup?: string;
	readonly target?: string;
};
const isRecord = function (value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};
const recovery = function (stdout: string) {
	const directory = /^Recovery backups: (.+)$/m.exec(stdout)?.[1];
	if (directory === undefined) throw new Error("deployment did not report recovery directory");
	const parsed: unknown = JSON.parse(readFileSync(join(directory, "journal.json"), "utf8"));
	if (!Array.isArray(parsed)) throw new Error("recovery journal must be an array");
	const entries: RecoveryRecord[] = parsed.map(function (value: unknown) {
		if (!isRecord(value) || typeof value.path !== "string" || typeof value.before !== "string" || typeof value.after !== "string") {
			throw new Error("invalid recovery record");
		}
		if (value.backup !== undefined && typeof value.backup !== "string") throw new Error("invalid recovery backup path");
		if (value.target !== undefined && typeof value.target !== "string") throw new Error("invalid recovery link target");
		return { path: value.path, before: value.before, after: value.after,
			...(typeof value.backup === "string" ? { backup: value.backup } : {}),
			...(typeof value.target === "string" ? { target: value.target } : {}) };
	});
	const record = function (path: string): RecoveryRecord {
		const matches = entries.filter(function (entry) { return entry.path === path; });
		expect(matches).toHaveLength(1);
		const entry = matches[0];
		if (entry === undefined) throw new Error("missing recovery record for " + path);
		return entry;
	};
	return { directory, record };
};
const expectBackup = function (record: RecoveryRecord, content: Buffer): void {
	if (record.backup === undefined) throw new Error("missing backup for " + record.path);
	expect(readFileSync(record.backup).equals(content)).toBe(true);
};

test("fresh install previews without writes and repeated application is a no-op", function () {
	const before = fixture.tree();
	const plan = fixture.run(["--harness", "codex", "--dry-run", "--diff"]);
	expect(plan.stdout).toContain("Would write instructions");
	expect(plan.stdout).toContain("+Shared instructions.");
	expect(fixture.tree()).toEqual(before);
	fixture.run(["--harness", "codex", "--check"], 1);
	expect(fixture.tree()).toEqual(before);
	fixture.run(["--harness", "codex"]);
	const target = join(fixture.home, ".codex/AGENTS.md");
	expect(lstatSync(target).isFile()).toBe(true);
	expect(readFileSync(target)).toEqual(readFileSync(fixture.shared));
	expect(isLink(join(fixture.home, ".agents/skills/sync-agent-config"))).toBe(true);
	expectAbsent(join(fixture.home, ".claude"));
	const installed = fixture.tree();
	fixture.run(["--harness", "codex"]);
	fixture.run(["--check"]);
	expect(fixture.tree()).toEqual(installed);
});

test("addenda and shared instructions update, with replaced contents backed up", function () {
	const add = join(fixture.repo, "instructions/codex.md");
	writeFileSync(add, "Codex specifics.\n");
	fixture.run(["--harness", "codex"]);
	const target = join(fixture.home, ".codex/AGENTS.md");
	expect(readFileSync(target, "utf8")).toBe("Shared instructions.\n\nCodex specifics.\n");
	writeFileSync(fixture.shared, "New shared.\n");
	writeFileSync(add, "New addendum.\n");
	chmodSync(target, 0o640);
	fixture.run(["--check"], 1);
	const update = fixture.run();
	expect(readFileSync(target, "utf8")).toBe("New shared.\n\nNew addendum.\n");
	expect(lstatSync(target).mode & 0o777).toBe(0o640);
	const original = recovery(update.stdout).record(target);
	expect(original.before).toBe("file");
	expect(original.after).toBe("file");
	expectBackup(original, Buffer.from("Shared instructions.\n\nCodex specifics.\n"));
	writeFileSync(add, "");
	const removal = fixture.run();
	expect(readFileSync(target, "utf8")).toBe("New shared.\n");
	expectBackup(recovery(removal.stdout).record(target), Buffer.from("New shared.\n\nNew addendum.\n"));
});

test("initial conflicts and subsequent local edits block every planned write", function () {
	const dest = join(fixture.home, ".codex/AGENTS.md");
	fixture.write(dest, "Existing instructions.\n");
	const before = fixture.tree();
	const result = fixture.run(["--harness", "codex", "--harness", "claude", "--diff"], 2);
	expect(result.stderr).toContain("Conflict:");
	expect(result.stdout).toContain("-Existing instructions.");
	expect(fixture.tree()).toEqual(before);
	writeFileSync(fixture.shared, readFileSync(dest));
	fixture.run(["--harness", "codex"]);
	writeFileSync(dest, "Local edits.\n");
	writeFileSync(fixture.shared, "Upstream edits.\n");
	const edited = fixture.tree();
	fixture.run(["--dry-run"], 2);
	fixture.run([], 2);
	expect(fixture.tree()).toEqual(edited);
	writeFileSync(fixture.shared, readFileSync(dest));
	fixture.run();
	fixture.run(["--check"]);
});

test("force previews and backs up initial instruction overwrites for selected harnesses", function () {
	const dest = join(fixture.home, ".codex/AGENTS.md");
	const untouched = join(fixture.home, ".claude/CLAUDE.md");
	fixture.write(dest, "Existing instructions.\n");
	fixture.write(untouched, "Keep Claude instructions.\n");
	chmodSync(dest, 0o640);
	const args = ["--harness", "codex", "--force"];
	const before = fixture.tree();
	const preview = fixture.run([...args, "--dry-run", "--diff"]);
	expect(preview.stdout).toContain("Would force overwrite instructions");
	expect(preview.stdout).toContain("-Existing instructions.");
	expect(preview.stdout).toContain("+Shared instructions.");
	fixture.run([...args, "--check"], 1);
	expect(fixture.tree()).toEqual(before);
	const applied = fixture.run(args);
	expectBackup(recovery(applied.stdout).record(dest), Buffer.from("Existing instructions.\n"));
	expect(readFileSync(dest)).toEqual(readFileSync(fixture.shared));
	expect(lstatSync(dest).mode & 0o777).toBe(0o640);
	expect(readFileSync(untouched, "utf8")).toBe("Keep Claude instructions.\n");
	fixture.run(["--harness", "codex", "--check"]);
	const installed = fixture.tree();
	fixture.run(args);
	expect(fixture.tree()).toEqual(installed);
});

test("force backs up local edits and records ownership for subsequent normal updates", function () {
	fixture.run(["--harness", "codex"]);
	const dest = join(fixture.home, ".codex/AGENTS.md");
	writeFileSync(dest, "Local edits.\n");
	writeFileSync(fixture.shared, "Upstream edits.\n");
	fixture.run([], 2);
	const applied = fixture.run(["--force"]);
	expectBackup(recovery(applied.stdout).record(dest), Buffer.from("Local edits.\n"));
	expect(readFileSync(dest, "utf8")).toBe("Upstream edits.\n");
	fixture.run(["--check"]);
	writeFileSync(fixture.shared, "Next update.\n");
	fixture.run();
	expect(readFileSync(dest, "utf8")).toBe("Next update.\n");
});

test("force preserves instruction links, directories, and skill collisions without any writes", function () {
	const dest = join(fixture.home, ".codex/AGENTS.md");
	const external = join(fixture.base, "external.md");
	fixture.write(external, "External instructions.\n");
	fixture.write(dest, "Existing instructions.\n");
	const skill = join(fixture.home, ".agents/skills/sync-agent-config");
	fixture.write(join(skill, "SKILL.md"), "Existing skill.\n");
	const before = fixture.tree();
	fixture.run(["--harness", "codex", "--force"], 2);
	expect(fixture.tree()).toEqual(before);
	rmSync(skill, { recursive: true });
	unlinkSync(dest);
	const repoInstruction = join(fixture.repo, "instructions/legacy.md");
	fixture.write(repoInstruction, "Legacy instructions.\n");
	for (const target of [external, repoInstruction]) {
		symlinkSync(target, dest);
		const linked = fixture.tree();
		fixture.run(["--harness", "codex", "--force"], 2);
		expect(fixture.tree()).toEqual(linked);
		unlinkSync(dest);
	}
	expect(readFileSync(external, "utf8")).toBe("External instructions.\n");
	mkdirSync(dest);
	const directory = fixture.tree();
	fixture.run(["--harness", "codex", "--force"], 2);
	expect(fixture.tree()).toEqual(directory);
});

test("empty shared instructions preserve destinations and skip addenda while skills sync", function () {
	writeFileSync(fixture.shared, " \n");
	writeFileSync(join(fixture.repo, "instructions/codex.md"), "Addendum only.\n");
	const dest = join(fixture.home, ".codex/AGENTS.md");
	fixture.write(dest, "Keep me.\n");
	fixture.run(["--dry-run"]);
	fixture.run(["--force"]);
	expect(readFileSync(dest, "utf8")).toBe("Keep me.\n");
	expect(isLink(join(fixture.home, ".agents/skills/sync-agent-config"))).toBe(true);
	expect(fixture.run(["--check"], 1).stdout).toContain("Skipped instruction deployment");
	const before = fixture.tree();
	fixture.run();
	expect(fixture.tree()).toEqual(before);
});

test("empty source preserves Grok's existing or absent compatibility config", function () {
	writeFileSync(fixture.shared, "");
	const config = join(fixture.home, ".grok/config.toml");
	fixture.write(config, "[compat.claude]\nagents = true\n");
	for (const content of ["[compat.claude]\nagents = true\n", undefined]) {
		if (content === undefined) unlinkSync(config);
		else writeFileSync(config, content);
		fixture.run();
		expectAbsent(join(fixture.home, ".grok/Agents.md"));
		if (content === undefined) expectAbsent(config);
		else expect(readFileSync(config, "utf8")).toBe(content);
		expect(isLink(join(fixture.home, ".grok/skills/sync-agent-config"))).toBe(true);
		fixture.run(["--check"], 1);
	}
});

test("renamed/deleted skills are reconciled without changing unrelated skills or plugin contents", function () {
	const skillDir = join(fixture.home, ".agents/skills");
	const unrelated = join(skillDir, "unrelated/SKILL.md");
	fixture.write(unrelated, "User-owned skill");
	const pluginCache = join(fixture.base, "plugin-cache");
	fixture.write(join(pluginCache, "SKILL.md"), "Marketplace skill");
	symlinkSync(pluginCache, join(skillDir, "native-plugin"));
	const native = join(fixture.home, ".codex/plugins/cache/manifest.json");
	fixture.write(native, '{"installed": true}');
	fixture.run();
	renameSync(join(fixture.repo, "skills/sync-agent-config"), join(fixture.repo, "skills/renamed"));
	expect(fixture.run(["--check"], 1).stdout).toContain("remove obsolete skill link");
	fixture.run();
	expectAbsent(join(skillDir, "sync-agent-config"));
	expect(isLink(join(skillDir, "renamed"))).toBe(true);
	rmSync(join(fixture.repo, "skills/renamed"), { recursive: true });
	fixture.run();
	expectAbsent(join(skillDir, "renamed"));
	expect(readFileSync(unrelated, "utf8")).toBe("User-owned skill");
	expect(readlinkSync(join(skillDir, "native-plugin"))).toBe(pluginCache);
	expect(readFileSync(join(pluginCache, "SKILL.md"), "utf8")).toBe("Marketplace skill");
	expect(readFileSync(native, "utf8")).toBe('{"installed": true}');
});

test("changed obsolete skill links are never removed", function () {
	fixture.run(["--harness", "codex"]);
	const link = join(fixture.home, ".agents/skills/sync-agent-config");
	unlinkSync(link);
	symlinkSync(join(fixture.base, "unrelated"), link);
	rmSync(join(fixture.repo, "skills/sync-agent-config"), { recursive: true });
	const before = fixture.tree();
	fixture.run(["--check"], 2);
	fixture.run([], 2);
	expect(fixture.tree()).toEqual(before);
});

test("redirected source cannot claim a changed destination link", function () {
	fixture.run(["--harness", "codex"]);
	const source = join(fixture.repo, "skills/sync-agent-config");
	const external = join(fixture.base, "external skill");
	renameSync(source, external);
	symlinkSync(external, source);
	const dest = join(fixture.home, ".agents/skills/sync-agent-config");
	unlinkSync(dest);
	symlinkSync(external, dest);
	for (const keepSkillFile of [true, false]) {
		if (!keepSkillFile) unlinkSync(join(external, "SKILL.md"));
		const before = fixture.tree();
		fixture.run(["--dry-run"], 2);
		fixture.run([], 2);
		expect(fixture.tree()).toEqual(before);
		expect(readlinkSync(dest)).toBe(external);
	}
});

test("destination aliases are not treated as managed for live or deleted sources", function () {
	fixture.run(["--harness", "codex"]);
	const source = join(fixture.repo, "skills/sync-agent-config");
	const alias = join(fixture.base, "external alias");
	symlinkSync(source, alias);
	const dest = join(fixture.home, ".agents/skills/sync-agent-config");
	unlinkSync(dest);
	symlinkSync(alias, dest);
	for (const sourceExists of [true, false]) {
		if (!sourceExists) rmSync(source, { recursive: true });
		const before = fixture.tree();
		fixture.run(["--dry-run"], 2);
		fixture.run([], 2);
		expect(fixture.tree()).toEqual(before);
	}
});

test("detection handles absent harnesses and custom config paths", function () {
	expect(fixture.run().stdout).toContain("Detected harnesses: none");
	expectAbsent(fixture.home);
	mkdirSync(join(fixture.home, ".claude"), { recursive: true });
	expect(fixture.run(["--dry-run"]).stdout).toContain("Detected harnesses: claude");
	const custom = join(fixture.base, "custom codex");
	mkdirSync(custom);
	expect(fixture.run(["--config-dir", `codex=${custom}`]).stdout).toContain("Detected harnesses: claude, codex");
	expect(existsSync(join(custom, "AGENTS.md"))).toBe(true);
	fixture.run(["--config-dir", `codex=${custom}`, "--check"]);
	expectAbsent(join(fixture.home, ".codex"));
});

test("legacy instruction links migrate to regular files with link and content backups", function () {
	const dest = join(fixture.home, ".codex/AGENTS.md");
	mkdirSync(join(fixture.home, ".codex"), { recursive: true });
	symlinkSync(fixture.shared, dest);
	const result = fixture.run();
	expect(lstatSync(dest).isFile()).toBe(true);
	expect(readFileSync(dest)).toEqual(readFileSync(fixture.shared));
	expect(readFileSync(fixture.shared, "utf8")).toBe("Shared instructions.\n");
	const record = recovery(result.stdout).record(dest);
	expect(record.before).toBe("link");
	expect(record.after).toBe("file");
	expect(record.target).toBe(fixture.shared);
	expectBackup(record, readFileSync(fixture.shared));
});

test("external instruction links remain untouched even if contents match", function () {
	const external = join(fixture.base, "external.md");
	writeFileSync(external, readFileSync(fixture.shared));
	const dest = join(fixture.home, ".codex/AGENTS.md");
	mkdirSync(join(fixture.home, ".codex"), { recursive: true });
	symlinkSync(external, dest);
	const before = fixture.tree();
	fixture.run([], 2);
	expect(fixture.tree()).toEqual(before);
});

test("Grok TOML edits preserve array tables, unrelated values, and comments", function () {
	const dest = join(fixture.home, ".grok/config.toml");
	const cases = [
		{ source: '[compat.claude]\n# keep comment\nother = true\n\n[[servers]]\nname = "test"\nagents = true\n',
			expected: { compat: { claude: { other: true, agents: false } }, servers: [{ name: "test", agents: true }] }, comment: "# keep comment" },
		{ source: '[compat.claude]\nagents = true # preserve\n', expected: { compat: { claude: { agents: false } } }, comment: "# preserve" },
		{ source: '[other]\nvalue = "#foo"\n', expected: { other: { value: "#foo" }, compat: { claude: { agents: false } } }, comment: "" },
		{ source: '[compat.claude]', expected: { compat: { claude: { agents: false } } }, comment: "" },
	];
	for (const scenario of cases) {
		fixture.write(dest, scenario.source);
		const before = fixture.tree();
		fixture.run(["--dry-run", "--diff"]);
		expect(fixture.tree()).toEqual(before);
		fixture.run();
		const actual = readFileSync(dest, "utf8");
		const parsed: unknown = Bun.TOML.parse(actual);
		expect(parsed).toEqual(scenario.expected);
		if (scenario.comment) expect(actual).toContain(scenario.comment);
		fixture.run(["--check"]);
	}
});

test("invalid TOML, string booleans, and unsupported inline layouts block writes", function () {
	const dest = join(fixture.home, ".grok/config.toml");
	for (const text of ['[compat.claude]\nagents = "false"\n', '[compat]\nclaude = { agents = true }\n', '[invalid\n',
		'[compat.claude]\nagents = true\n[compat.claude]\nother = true\n',
		'[compat.claude]\nagents = false\n[compat.claude]\nother = true\n']) {
		fixture.write(dest, text);
		const before = fixture.tree();
		fixture.run([], 2);
		expect(fixture.tree()).toEqual(before);
	}
});


test("symlinked whole skill directories cannot modify external contents", function () {
	const external = join(fixture.base, "marketplace-owned");
	mkdirSync(external);
	mkdirSync(join(fixture.home, ".codex"), { recursive: true });
	mkdirSync(join(fixture.home, ".agents"), { recursive: true });
	symlinkSync(external, join(fixture.home, ".agents/skills"));
	const before = fixture.tree();
	fixture.run([], 2);
	expect(fixture.tree()).toEqual(before);
	expect(readdirSync(external)).toEqual([]);
});

test("explicit selection leaves unselected harness edits alone", function () {
	fixture.run(["--harness", "codex", "--harness", "claude", "--harness", "grok"]);
	fixture.run(["--check"]);
	const codex = join(fixture.home, ".codex/AGENTS.md");
	writeFileSync(codex, "Local codex edit.\n");
	writeFileSync(fixture.shared, "New shared.\n");
	fixture.run(["--harness", "claude"]);
	expect(readFileSync(codex, "utf8")).toBe("Local codex edit.\n");
	expect(readFileSync(join(fixture.home, ".claude/CLAUDE.md"), "utf8")).toBe("New shared.\n");
});

test("malformed deployment state blocks all writes", function () {
	const state = join(fixture.home, ".local/state/agent-config/state.json");
	for (const content of ['{}', '{"version":1,"entries":{"relative":{"kind":"skill","target":"bad"}}}', 'not json']) {
		fixture.write(state, content);
		const before = fixture.tree();
		fixture.run(["--harness", "codex"], 2);
		expect(fixture.tree()).toEqual(before);
	}
});

test("existing version-1 state supports updates, conflicts, exact backups, and cleanup", function () {
	const instruction = join(fixture.home, ".codex/AGENTS.md");
	const oldContents = "Old shared instructions: caf\u00e9.\n";
	fixture.write(instruction, oldContents);
	const legacySkill = join(fixture.home, ".codex/skills/deleted");
	mkdirSync(join(fixture.home, ".codex/skills"));
	const legacyTarget = join(fixture.repo, "skills/deleted");
	symlinkSync(legacyTarget, legacySkill);
	// Python's json.dumps escapes non-ASCII by default. Keep that encoding and
	// the original version/schema, with no migration command required.
	const serialized = JSON.stringify({ version: 1, entries: {
		[instruction]: { kind: "instruction", content: oldContents },
		[legacySkill]: { kind: "skill", target: legacyTarget },
	} }, null, 2).replaceAll("é", "\\u00e9") + "\n";
	fixture.write(join(fixture.home, ".local/state/agent-config/state.json"), serialized);
	writeFileSync(instruction, "Local edit.\n");
	const before = fixture.tree();
	fixture.run(["--dry-run"], 2);
	expect(fixture.tree()).toEqual(before);
	writeFileSync(instruction, oldContents);
	fixture.run(["--check"], 1);
	const update = fixture.run();
	expect(readFileSync(instruction, "utf8")).toBe("Shared instructions.\n");
	expectAbsent(legacySkill);
	const journal = recovery(update.stdout);
	expectBackup(journal.record(instruction), Buffer.from(oldContents));
	expect(journal.record(legacySkill)).toEqual({ path: legacySkill, before: "link", after: "missing", target: legacyTarget });
	expect(readFileSync(join(journal.directory, "state.json.bak"), "utf8")).toBe(serialized);
	fixture.run(["--check"]);
});

test("deployment and bun run apply require neither Python nor installed packages", function () {
	const bin = join(fixture.base, "bin");
	mkdirSync(bin);
	symlinkSync(process.execPath, join(bin, "bun"));
	symlinkSync("/usr/bin/dirname", join(bin, "dirname"));
	const env = { ...fixture.env, PATH: bin };
	const deploy = Bun.spawnSync(["/bin/bash", join(fixture.repo, "apply.sh"), "--harness", "codex"], { env });
	expect(deploy.exitCode, deploy.stderr.toString()).toBe(0);
	const check = Bun.spawnSync([process.execPath, "run", "apply", "--check"], { env, cwd: fixture.repo });
	expect(check.exitCode, check.stdout.toString() + check.stderr.toString()).toBe(0);
	expectAbsent(join(fixture.repo, "node_modules"));
});


test("all harnesses install in native personal locations", function () {
	fixture.run(["--harness", "codex", "--harness", "claude", "--harness", "grok"]);
	for (const root of [".agents", ".claude", ".grok"]) {
		for (const name of ["sync-agent-config", "goal-planning", "project-delivery"]) {
			expect(readlinkSync(join(fixture.home, root, "skills", name))).toBe(join(fixture.repo, "skills", name));
		}
	}
	expectAbsent(join(fixture.home, ".codex/skills"));
	fixture.run(["--check"]);
});

const legacyCodex = function (): string {
	const dest = join(fixture.home, ".codex/skills/sync-agent-config");
	const target = join(fixture.repo, "skills/sync-agent-config");
	fixture.write(join(fixture.home, ".codex/skills/.system/builtin/SKILL.md"), "Application-owned built-in");
	symlinkSync(target, dest);
	fixture.write(join(fixture.home, ".local/state/agent-config/state.json"), JSON.stringify({
		version: 1, entries: { [dest]: { kind: "skill", target } },
	}));
	return dest;
};

test("legacy Codex migration preserves unmanaged links and system/plugin files", function () {
	const legacy = legacyCodex();
	const untracked = join(fixture.home, ".codex/skills/untracked");
	symlinkSync(join(fixture.repo, "skills/project-delivery"), untracked);
	fixture.write(join(fixture.home, ".codex/plugins/cache/manifest.json"), "Keep plugin registration");
	const before = fixture.tree();
	expect(fixture.run(["--dry-run"]).stdout).toContain("remove legacy Codex skill link");
	expect(fixture.tree()).toEqual(before);
	fixture.run();
	expectAbsent(legacy);
	expect(readlinkSync(untracked)).toBe(join(fixture.repo, "skills/project-delivery"));
	expect(readFileSync(join(fixture.home, ".codex/skills/.system/builtin/SKILL.md"), "utf8")).toBe("Application-owned built-in");
	expect(readFileSync(join(fixture.home, ".codex/plugins/cache/manifest.json"), "utf8")).toBe("Keep plugin registration");
	expect(isLink(join(fixture.home, ".agents/skills/sync-agent-config"))).toBe(true);
	fixture.run(["--check"]);
});

test("locally changed legacy links block migration without writes", function () {
	const legacy = legacyCodex();
	unlinkSync(legacy);
	symlinkSync(join(fixture.base, "unrelated"), legacy);
	const before = fixture.tree();
	fixture.run(["--dry-run"], 2);
	fixture.run([], 2);
	expect(fixture.tree()).toEqual(before);
	expectAbsent(join(fixture.home, ".agents"));
});

test("a native-destination collision blocks migration without removing legacy links", function () {
	const legacy = legacyCodex();
	const dest = join(fixture.home, ".agents/skills/sync-agent-config");
	cpSync(join(fixture.repo, "skills/sync-agent-config"), dest, { recursive: true });
	for (const matching of [true, false]) {
		if (!matching) writeFileSync(join(dest, "SKILL.md"), "Existing skill with local changes");
		const before = fixture.tree();
		fixture.run([], 2);
		expect(fixture.tree()).toEqual(before);
		expect(readlinkSync(legacy)).toBe(join(fixture.repo, "skills/sync-agent-config"));
	}
});

test("redirected legacy directories cannot remove links owned by another location", function () {
	legacyCodex();
	const oldBase = join(fixture.home, ".codex/skills");
	const external = join(fixture.base, "redirected skills");
	renameSync(oldBase, external);
	symlinkSync(external, oldBase);
	const before = fixture.tree();
	fixture.run([], 2);
	expect(fixture.tree()).toEqual(before);
	expect(isLink(join(external, "sync-agent-config"))).toBe(true);
});

test("Codex config path does not redirect native skills; explicit skill override is supported", function () {
	const config = join(fixture.base, "custom codex");
	fixture.run(["--harness", "codex", "--config-dir", `codex=${config}`]);
	expect(existsSync(join(config, "AGENTS.md"))).toBe(true);
	expectAbsent(join(config, "skills"));
	expect(isLink(join(fixture.home, ".agents/skills/sync-agent-config"))).toBe(true);
	const skills = join(fixture.base, "custom personal skills");
	fixture.run(["--harness", "codex", "--config-dir", `codex=${config}`, "--skills-dir", `codex=${skills}`]);
	expect(isLink(join(skills, "sync-agent-config"))).toBe(true);
	fixture.run(["--harness", "codex", "--config-dir", `codex=${config}`, "--skills-dir", `codex=${skills}`, "--check"]);
});

test("Claude and Grok custom config paths retain native skills subdirectories", function () {
	const claude = join(fixture.base, "custom claude");
	const grok = join(fixture.base, "custom grok");
	const args = ["--harness", "claude", "--harness", "grok", "--config-dir", `claude=${claude}`, "--config-dir", `grok=${grok}`];
	fixture.run(args);
	for (const path of [claude, grok]) {
		expect(readlinkSync(join(path, "skills/project-delivery"))).toBe(join(fixture.repo, "skills/project-delivery"));
	}
	expect(existsSync(join(claude, "CLAUDE.md"))).toBe(true);
	expect(existsSync(join(grok, "Agents.md"))).toBe(true);
	fixture.run([...args, "--check"]);
});

test.each([".claude/CLAUDE.md", ".codex/AGENTS.md"])("failed replacement of %s preserves old contents and permits recovery", function (failedPath) {
	const args = ["--harness", "claude", "--harness", "codex"];
	writeFileSync(join(fixture.repo, "instructions/claude.md"), "Claude-specific.\n");
	writeFileSync(join(fixture.repo, "instructions/codex.md"), "Codex-specific.\n");
	fixture.run(args);
	const claude = join(fixture.home, ".claude/CLAUDE.md");
	const codex = join(fixture.home, ".codex/AGENTS.md");
	const originals = new Map([claude, codex].map(function (path) { return [path, readFileSync(path)] as const; }));
	const state = join(fixture.home, ".local/state/agent-config/state.json");
	const originalState = readFileSync(state);
	writeFileSync(fixture.shared, "Updated instructions.\n");
	fixture.env.AGENT_CONFIG_TEST_FAIL_DEST = join(fixture.home, failedPath);
	const result = fixture.run(args, 2, join(SOURCE, "tests/helpers/fail-replacement.ts"));
	expect(result.stderr).toContain("Injected replacement failure");
	const journal = recovery(result.stdout);
	expect(readFileSync(state)).toEqual(originalState);
	expect(readFileSync(join(journal.directory, "state.json.bak"))).toEqual(originalState);
	for (const [path, original] of originals) {
		const record = journal.record(path);
		expect(record.before).toBe("file");
		expect(record.after).toBe("file");
		expectBackup(record, original);
		const appliedBeforeFailure = failedPath === ".codex/AGENTS.md" && path === claude;
		expect(readFileSync(path)).toEqual(appliedBeforeFailure ? Buffer.from("Updated instructions.\n\nClaude-specific.\n") : original);
		expect(readdirSync(dirname(path)).filter(function (name) { return name.startsWith(".agent-config-"); })).toEqual([]);
		// Restore from the documented recovery records, not from test originals.
		if (record.backup === undefined) throw new Error("missing recovery backup");
		writeFileSync(path, readFileSync(record.backup));
	}
	for (const [path, original] of originals) expect(readFileSync(path)).toEqual(original);
	fixture.run([...args, "--check"], 1);
	fixture.run(args);
	fixture.run([...args, "--check"]);
});
