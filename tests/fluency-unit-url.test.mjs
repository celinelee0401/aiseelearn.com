import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { urlWithUnit } from "../apps/fluency-challenge/lib/unit-url.mjs";

test("the loaded unit replaces a stale URL prefill without dropping other URL state", () => {
  assert.equal(
    urlWithUnit("https://fluency-challenge-staging.netlify.app/?unit=B3U1-TEST3&from=planner#login", "B3U2"),
    "https://fluency-challenge-staging.netlify.app/?unit=B3U2&from=planner#login"
  );
});

test("the loaded unit is added to a plain student URL", () => {
  assert.equal(
    urlWithUnit("https://fluency-challenge-staging.netlify.app/", "B3U2"),
    "https://fluency-challenge-staging.netlify.app/?unit=B3U2"
  );
});

test("the student page synchronizes its form and URL only after a task loads", async () => {
  const source = await readFile(new URL("../apps/fluency-challenge/app.mjs", import.meta.url), "utf8");
  assert.match(source, /state\.task = body\.task;\s*elements\.unitId\.value = state\.task\.unitId;\s*window\.history\.replaceState\(/);
});
