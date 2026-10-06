// Loaded only by an isolated test subprocess. Keep production deployment free
// of fault-injection options while exercising its real error/recovery path.
import { mock } from "bun:test";
import * as filesystem from "node:fs";
import type { PathLike } from "node:fs";

const destination = process.env.AGENT_CONFIG_TEST_FAIL_DEST;
if (destination === undefined) throw new Error("failure destination is required");
const originalRename = filesystem.renameSync;
mock.module("node:fs", function () {
	return {
		...filesystem,
		renameSync: function (from: PathLike, to: PathLike): void {
			if (to === destination) throw new Error("Injected replacement failure");
			originalRename(from, to);
		},
	};
});
