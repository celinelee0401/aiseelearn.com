#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REQUIRED_SOURCE_FILES = [
  "appsscript.json",
  "程式碼.gs",
  "SeatPlanner.gs",
  "SeatPlannerUI.html"
];

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
    values[name] = value;
    index += 1;
  }
  return values;
}

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Required file is missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Could not find ${label}.`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Found more than one ${label}; refusing an ambiguous merge.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function findFunctionRange(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Could not find ${functionName}().`);
  const openingBrace = source.indexOf("{", start + marker.length);
  if (openingBrace < 0) throw new Error(`Could not find the body of ${functionName}().`);

  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingBrace; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      quote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }
  throw new Error(`Could not find the end of ${functionName}().`);
}

export function replaceFunction(source, functionName, replacement) {
  const range = findFunctionRange(source, functionName);
  return source.slice(0, range.start) + replacement + source.slice(range.end);
}

function extractPanelScript(panelSource) {
  const match = panelSource.match(/^\s*<script\s+type=["']text\/babel["']\s*>([\s\S]*?)<\/script>\s*$/);
  if (!match) throw new Error("SeatPlannerFluencyPanel.html must contain one text/babel script block.");
  return match[1].trim();
}

export function mergeTeacherPanel(uiSource, panelSource) {
  if (uiSource.includes("function FluencyPanel(")) {
    throw new Error("SeatPlannerUI.html already contains FluencyPanel; refusing to merge twice.");
  }
  let merged = replaceOnce(
    uiSource,
    "function App(){",
    `${extractPanelScript(panelSource)}\n\nfunction App(){`,
    "App component marker"
  );
  merged = replaceOnce(
    merged,
    "</header>\n  <div className={`grid gap-4",
    `</header>\n  {teacherRole&&teacher&&<div className="teacher-only mb-4"><FluencyPanel className={className} token={token} onAuthFailure={authFailure}/></div>}\n  <div className={\`grid gap-4`,
    "authenticated dashboard insertion point"
  );
  return merged;
}

function buildDemoSeatPlanner(source, setupTokenHash) {
  if (!/^[a-f0-9]{64}$/.test(String(setupTokenHash || ""))) {
    throw new Error("A 64-character lowercase --setup-token-hash is required.");
  }
  let output = source.replace(
    /var SEAT_PLANNER_SOURCE = \{[\s\S]*?\n\};/,
    `var SEAT_PLANNER_SOURCE = {\n  'DEMO': { sheet: 'DEMO_ONLY', logSheet: 'DEMO_ONLY', label: 'Fluency Challenge 隔離測試班' }\n};`
  );
  if (!output.includes("Fluency Challenge 隔離測試班")) {
    throw new Error("Could not replace SEAT_PLANNER_SOURCE for demo mode.");
  }
  output = output.replace(
    /setupTokenHash:\s*'[a-f0-9]{64}'/,
    `setupTokenHash: '${setupTokenHash}'`
  );
  if (!output.includes(`setupTokenHash: '${setupTokenHash}'`)) {
    throw new Error("Could not isolate the staging teacher setup token.");
  }
  output = replaceOnce(
    output,
    "minimumPasswordLength: 10",
    "minimumPasswordLength: 8",
    "staging minimum teacher password length"
  );

  output = replaceFunction(output, "readPlannerSeed_", `function readPlannerSeed_(className) {
  assertPlannerClass_(className);
  return {
    students: [
      { id: '1', number: 1, name: 'Demo Student 01', groupId: 'G1', track: 'S1', score: 0, speakOut: 0 },
      { id: '2', number: 2, name: 'Demo Student 02', groupId: 'G1', track: 'S2', score: 0, speakOut: 0 },
      { id: '3', number: 3, name: 'Demo Student 03', groupId: 'G2', track: 'S3', score: 0, speakOut: 0 },
      { id: '4', number: 4, name: 'Demo Student 04', groupId: 'G2', track: 'S4', score: 0, speakOut: 0 }
    ],
    seatMap: { R1C3: '1', R1C4: '2', R1C2: '3', R1C5: '4' }
  };
}`);
  output = replaceFunction(output, "syncPlannerStudentsToSheet_", `function syncPlannerStudentsToSheet_(className, students, seatMap) {
  assertPlannerClass_(className);
  // Isolation guarantee: demo mode never writes to the production roster Sheet.
}`);
  output = replaceFunction(output, "appendSeatPlannerLog_", `function appendSeatPlannerLog_(className, logData, role) {
  assertPlannerClass_(className);
  // Isolation guarantee: demo mode keeps no production classroom log.
}`);
  return output;
}

function buildDemoUi(source) {
  let output = replaceOnce(source, 'useState("816")', 'useState("DEMO")', "default class");
  output = replaceOnce(
    output,
    '<option value="801">801</option><option value="816">816</option>',
    '<option value="DEMO">DEMO 隔離測試班</option>',
    "class selector"
  );
  output = replaceOnce(output, "password.length<10", "password.length<8", "teacher password length check");
  output = output.replaceAll("至少 10 個字元", "至少 8 個字元");
  return output;
}

function buildDemoSeatPlannerApi(source) {
  const output = source.replace(/'115'/g, "'9999'");
  if (output === source || output.includes("schoolYear: '115'")) {
    throw new Error("Could not isolate the staging school year.");
  }
  return output;
}

export function buildSeatPlannerStagingBundle({ sourceDirectory, outputDirectory, patchDirectory, setupTokenHash }) {
  if (!sourceDirectory || !outputDirectory || !patchDirectory || !setupTokenHash) {
    throw new Error("sourceDirectory, outputDirectory, patchDirectory, and setupTokenHash are required.");
  }
  const source = Object.fromEntries(REQUIRED_SOURCE_FILES.map(fileName => [
    fileName,
    readRequired(path.join(sourceDirectory, fileName))
  ]));
  const panel = readRequired(path.join(patchDirectory, "SeatPlannerFluencyPanel.html"));
  const api = readRequired(path.join(patchDirectory, "SeatPlannerApi.gs"));

  if (!source["SeatPlanner.gs"].includes("function assertPlannerSession_(")) {
    throw new Error("The source project does not expose the expected authenticated planner session.");
  }
  if (!source["SeatPlanner.gs"].includes("function readPlannerSeed_(")) {
    throw new Error("The source project does not expose the expected planner roster reader.");
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "appsscript.json"), source["appsscript.json"], "utf8");
  fs.writeFileSync(path.join(outputDirectory, "Code.gs"), `/** Isolated staging entry point: no legacy scoreboard or production Sheet access. */
function doGet(e) {
  return createSeatPlannerOutput_(e || { parameter: {} });
}

/**
 * One-time owner authorization helper for the isolated staging deployment.
 * Run this from the Apps Script editor before testing the web app.
 */
function authorizeFluencyStaging() {
  PropertiesService.getScriptProperties().getProperties();
  UrlFetchApp.fetch('https://fluency-challenge-staging.netlify.app/', {
    muteHttpExceptions: true
  });
  return true;
}
`, "utf8");
  fs.writeFileSync(
    path.join(outputDirectory, "SeatPlanner.gs"),
    buildDemoSeatPlanner(source["SeatPlanner.gs"], setupTokenHash),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outputDirectory, "SeatPlannerUI.html"),
    buildDemoUi(mergeTeacherPanel(source["SeatPlannerUI.html"], panel)),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outputDirectory, "SeatPlannerApi.gs"),
    buildDemoSeatPlannerApi(api),
    "utf8"
  );

  return {
    mode: "demo",
    outputDirectory,
    files: fs.readdirSync(outputDirectory).sort()
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = buildSeatPlannerStagingBundle({
      sourceDirectory: path.resolve(options.source || ""),
      outputDirectory: path.resolve(options.output || ""),
      patchDirectory: path.resolve(options.patch || "gas/seat-planner-api"),
      setupTokenHash: options["setup-token-hash"]
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
