import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the packaged Next server on the normal filesystem", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(packageJson.build.asar, false);
  assert.equal(packageJson.build.asarUnpack, undefined);
});
