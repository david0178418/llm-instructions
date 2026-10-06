import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
	readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync,
	unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const SOURCE = realpathSync(join(import.meta.dir, ".."));
class Fixture {
	readonly base = realpathSync(mkdtempSync(join(tmpdir(), "agent-config-test-")));
	readonly repo = join(this.base, "repo with spaces");
	readonly home = join(this.base, "home");
	readonly shared = join(this.repo, "instructions/user.md");
	readonly env = { ...process.env, AGENT_CONFIG_HOME: this.home };
	constructor() {
		mkdirSync(this.repo);
		for (const path of ["apply.sh", "scripts/apply.ts", "instructions", "skills", "package.json"]) {
			cpSync(join(SOURCE, path), join(this.repo, path), { recursive: true });
		}
		writeFileSync(this.shared, "Shared instructions.\n");
	}
	run(args: readonly string[] = [], code = 0) {
		const result = Bun.spawnSync(["/bin/bash", join(this.repo, "apply.sh"), ...args], { env: this.env });
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
const backupFiles = function (base: string): string[] {
	return readdirSync(base).flatMap(function (directory) {
		return readdirSync(join(base, directory)).filter(function (name) { return name.endsWith(".bak"); })
			.map(function (name) { return join(base, directory, name); });
	});
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
	expect(isLink(target)).toBe(false);
	expect(readFileSync(target)).toEqual(readFileSync(fixture.shared));
	expect(isLink(join(fixture.home, ".codex/skills/sync-agent-config"))).toBe(true);
	expect(existsSync(join(fixture.home, ".claude"))).toBe(false);
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
	fixture.run(["--check"], 1);
	fixture.run();
	expect(readFileSync(target, "utf8")).toBe("New shared.\n\nNew addendum.\n");
	writeFileSync(add, "");
	fixture.run();
	expect(readFileSync(target, "utf8")).toBe("New shared.\n");
	const backups = backupFiles(join(fixture.home, ".local/state/agent-config/backups"));
	expect(backups.some(function (path) { return readFileSync(path, "utf8") === "Shared instructions.\n\nCodex specifics.\n"; })).toBe(true);
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

test("empty shared instructions preserve destinations and skip addenda while skills sync", function () {
	writeFileSync(fixture.shared, " \n");
	writeFileSync(join(fixture.repo, "instructions/codex.md"), "Addendum only.\n");
	const dest = join(fixture.home, ".codex/AGENTS.md");
	fixture.write(dest, "Keep me.\n");
	fixture.run(["--dry-run"]);
	fixture.run();
	expect(readFileSync(dest, "utf8")).toBe("Keep me.\n");
	expect(isLink(join(fixture.home, ".codex/skills/sync-agent-config"))).toBe(true);
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
		expect(existsSync(join(fixture.home, ".grok/Agents.md"))).toBe(false);
		if (content === undefined) expect(existsSync(config)).toBe(false);
		else expect(readFileSync(config, "utf8")).toBe(content);
		expect(isLink(join(fixture.home, ".grok/skills/sync-agent-config"))).toBe(true);
		fixture.run(["--check"], 1);
	}
});

test("renamed/deleted skills are reconciled while native plugins and system skills survive", function () {
	const skillDir = join(fixture.home, ".codex/skills");
	mkdirSync(join(skillDir, ".system"), { recursive: true });
	symlinkSync(join(fixture.base, "plugin-cache"), join(skillDir, "native-plugin"));
	const native = join(fixture.home, ".codex/plugins/cache/manifest.json");
	fixture.write(native, '{"installed": true}');
	fixture.run();
	renameSync(join(fixture.repo, "skills/sync-agent-config"), join(fixture.repo, "skills/renamed"));
	expect(fixture.run(["--check"], 1).stdout).toContain("remove obsolete skill link");
	fixture.run();
	expect(isLink(join(skillDir, "sync-agent-config"))).toBe(false);
	expect(isLink(join(skillDir, "renamed"))).toBe(true);
	rmSync(join(fixture.repo, "skills/renamed"), { recursive: true });
	fixture.run();
	expect(isLink(join(skillDir, "renamed"))).toBe(false);
	expect(existsSync(join(skillDir, ".system"))).toBe(true);
	expect(readlinkSync(join(skillDir, "native-plugin"))).toBe(join(fixture.base, "plugin-cache"));
	expect(readFileSync(native, "utf8")).toBe('{"installed": true}');
});

test("changed obsolete skill links are never removed", function () {
	fixture.run(["--harness", "codex"]);
	const link = join(fixture.home, ".codex/skills/sync-agent-config");
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
	const dest = join(fixture.home, ".codex/skills/sync-agent-config");
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
	const dest = join(fixture.home, ".codex/skills/sync-agent-config");
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

test("pre-existing custom skill directories block even when contents match", function () {
	cpSync(join(fixture.repo, "skills/sync-agent-config"), join(fixture.home, ".codex/skills/sync-agent-config"), { recursive: true });
	const before = fixture.tree();
	fixture.run([], 2);
	expect(fixture.tree()).toEqual(before);
});

test("detection handles absent harnesses and custom config paths", function () {
	expect(fixture.run().stdout).toContain("Detected harnesses: none");
	expect(existsSync(fixture.home)).toBe(false);
	mkdirSync(join(fixture.home, ".claude"), { recursive: true });
	expect(fixture.run(["--dry-run"]).stdout).toContain("Detected harnesses: claude");
	const custom = join(fixture.base, "custom codex");
	mkdirSync(custom);
	expect(fixture.run(["--config-dir", `codex=${custom}`]).stdout).toContain("Detected harnesses: claude, codex");
	expect(existsSync(join(custom, "AGENTS.md"))).toBe(true);
	fixture.run(["--config-dir", `codex=${custom}`, "--check"]);
	expect(existsSync(join(fixture.home, ".codex"))).toBe(false);
});

test("legacy instruction links migrate to regular files with link and content backups", function () {
	const dest = join(fixture.home, ".codex/AGENTS.md");
	mkdirSync(join(fixture.home, ".codex"), { recursive: true });
	symlinkSync(fixture.shared, dest);
	fixture.run();
	expect(isLink(dest)).toBe(false);
	expect(readFileSync(fixture.shared, "utf8")).toBe("Shared instructions.\n");
	const base = join(fixture.home, ".local/state/agent-config/backups");
	const journals = readdirSync(base).map(function (name) { return readFileSync(join(base, name, "journal.json"), "utf8"); });
	expect(journals.some(function (journal) { return journal.includes(JSON.stringify(fixture.shared)); })).toBe(true);
	expect(backupFiles(base).some(function (path) { return readFileSync(path).equals(readFileSync(fixture.shared)); })).toBe(true);
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
	fixture.write(dest, '[compat.claude]\n# keep comment\nother = true\n\n[[servers]]\nname = "test"\nagents = true\n');
	const before = fixture.tree();
	fixture.run(["--dry-run", "--diff"]);
	expect(fixture.tree()).toEqual(before);
	fixture.run();
	const parsed: unknown = Bun.TOML.parse(readFileSync(dest, "utf8"));
	expect(parsed).toEqual({ compat: { claude: { other: true, agents: false } }, servers: [{ name: "test", agents: true }] });
	expect(readFileSync(dest, "utf8")).toContain("# keep comment");
	fixture.run(["--check"]);
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

test("Grok true, missing tables, and headings without newlines deploy correctly", function () {
	const dest = join(fixture.home, ".grok/config.toml");
	for (const text of ['[compat.claude]\nagents = true # preserve\n', '[other]\nvalue = "#foo"\n', '[compat.claude]']) {
		fixture.write(dest, text);
		fixture.run();
		expect(readFileSync(dest, "utf8")).toContain("agents = false");
		fixture.run(["--check"]);
	}
});

test("symlinked whole skill directories cannot modify external contents", function () {
	const external = join(fixture.base, "marketplace-owned");
	mkdirSync(external);
	mkdirSync(join(fixture.home, ".codex"), { recursive: true });
	symlinkSync(external, join(fixture.home, ".codex/skills"));
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

test("version-1 Python-format state supports updates, conflicts, backups, and cleanup", function () {
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
	fixture.run();
	expect(readFileSync(instruction, "utf8")).toBe("Shared instructions.\n");
	expect(isLink(legacySkill)).toBe(false);
	const backups = backupFiles(join(fixture.home, ".local/state/agent-config/backups"));
	expect(backups.some(function (path) { return readFileSync(path, "utf8") === serialized; })).toBe(true);
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
	expect(existsSync(join(fixture.repo, "node_modules"))).toBe(false);
});

test("invalid CLI arguments fail without writing and help remains available", function () {
	for (const args of [["--harness", "unknown"], ["--check", "--dry-run"], ["--config-dir", "codex="], ["--unexpected"]]) {
		fixture.run(args, 2);
		expect(existsSync(fixture.home)).toBe(false);
	}
	expect(fixture.run(["--help"]).stdout).toContain("usage: apply.sh");
});
