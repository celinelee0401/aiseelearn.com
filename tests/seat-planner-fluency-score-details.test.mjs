import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "gas/seat-planner-api/SeatPlannerFluencyPanel.html"), "utf8")
  .replace(/^<script type="text\/babel">\s*/, "")
  .replace(/\s*<\/script>\s*$/, "");

test("teacher score panel compiles and exposes the four existing round metrics", async () => {
  const result = await transform(source, { loader: "jsx", format: "esm", jsx: "transform" });
  assert.match(result.code, /React\.createElement/);
  assert.match(source, /type="button"[\s\S]*?aria-expanded=/);
  assert.match(source, /查看三輪評分/);
  for (const field of ["wpm", "pauseFlow", "pronunciationAccuracy", "prosody"]) {
    assert.match(source, new RegExp(`fluencyScoreValue\\(round\\.${field}\\)`));
  }

  const context = vm.createContext({});
  vm.runInContext(result.code, context);
  assert.equal(context.fluencyScoreValue(82.56), "82.6");
  assert.equal(context.fluencyScoreValue(null), "—");
  assert.equal(context.fluencyScoreValue("not-a-number"), "—");
});
