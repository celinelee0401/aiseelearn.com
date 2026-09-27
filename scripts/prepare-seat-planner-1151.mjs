#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeTeacherPanel, replaceFunction } from "./build-seat-planner-staging-bundle.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectDir = process.argv[2];
if (!projectDir) throw new Error("Pass the directory of a freshly cloned 115-1 Apps Script project.");

const read = (name) => fs.readFileSync(path.join(projectDir, name), "utf8");
const write = (name, value) => fs.writeFileSync(path.join(projectDir, name), value, "utf8");

const planner = read("SeatPlanner.js");
if (!planner.includes("'801': { sheet: '801_名單'") || !planner.includes("'816': { sheet: '816_名單'")) {
  throw new Error("The live project is not the expected 115-1 801/816 planner.");
}
if (!planner.includes("function assertPlannerSession_(") || !planner.includes("function readPlannerSeed_(")) {
  throw new Error("The planner authentication or roster API changed; review before merging.");
}

const panel = fs.readFileSync(path.join(repoRoot, "gas/seat-planner-api/SeatPlannerFluencyPanel.html"), "utf8");
const canonicalApi = fs.readFileSync(path.join(repoRoot, "gas/seat-planner-api/SeatPlannerApi.gs"), "utf8");
const ui = mergeTeacherPanel(read("SeatPlannerUI.html"), panel);
const code = replaceFunction(read("程式碼.js"), "doGet", `function doGet(e) {
  return createSeatPlannerOutput_(e || { parameter: {} });
}`);

if (read("SeatPlannerUI.html").includes("function FluencyPanel(")) {
  throw new Error("FluencyPanel is already installed; refusing to merge twice.");
}
if (!canonicalApi.includes("return body.data;")) {
  throw new Error("The canonical API is missing its expected response contract.");
}

write("SeatPlannerUI.html", ui);
write("SeatPlannerApi.js", canonicalApi);
write("程式碼.js", code);
process.stdout.write("Prepared 115-1 planner entry point, Fluency teacher panel, and canonical signed API.\n");
