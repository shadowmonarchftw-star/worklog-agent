import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { materializeSymlinks } = require("../scripts/prepare-standalone.cjs");

test("replaces standalone symlinks with portable files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worklog-standalone-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const dependency = path.join(root, "node_modules", "dependency");
  const tracedModules = path.join(root, ".next", "node_modules");
  fs.mkdirSync(dependency, { recursive: true });
  fs.mkdirSync(tracedModules, { recursive: true });
  fs.writeFileSync(path.join(dependency, "index.js"), "module.exports = true;");

  const tracedDependency = path.join(tracedModules, "dependency-trace");
  fs.symlinkSync(dependency, tracedDependency, "dir");

  materializeSymlinks(root);

  assert.equal(fs.lstatSync(tracedDependency).isSymbolicLink(), false);
  assert.equal(
    fs.readFileSync(path.join(tracedDependency, "index.js"), "utf8"),
    "module.exports = true;",
  );
});
