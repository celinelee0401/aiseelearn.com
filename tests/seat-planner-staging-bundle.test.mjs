import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSeatPlannerStagingBundle } from "../scripts/build-seat-planner-staging-bundle.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETUP_TOKEN_HASH = "a".repeat(64);

function makePatchFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seat-planner-patch-"));
  fs.writeFileSync(path.join(root, "SeatPlannerFluencyPanel.html"), `<script type="text/babel">
function FluencyPanel(){ return null; }
</script>`);
  fs.writeFileSync(
    path.join(root, "SeatPlannerApi.gs"),
    fs.readFileSync(path.join(projectRoot, "gas/seat-planner-api/SeatPlannerApi.gs"), "utf8")
  );
  return root;
}

function makeSourceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seat-planner-source-"));
  fs.writeFileSync(path.join(root, "appsscript.json"), '{"runtimeVersion":"V8"}');
  fs.writeFileSync(path.join(root, "程式碼.gs"), "function doGet() {}\n");
  fs.writeFileSync(path.join(root, "SeatPlanner.gs"), `
var SEAT_PLANNER_SOURCE = {
  '801': { sheet: '801_名單' },
  '816': { sheet: '816_名單' }
};
var SEAT_PLANNER_AUTH = {
  setupTokenHash: '${"b".repeat(64)}',
  minimumPasswordLength: 10
};
function readPlannerSeed_(className) { return { students: [] }; }
function syncPlannerStudentsToSheet_(className, students, seatMap) { SpreadsheetApp.openById('production'); }
function appendSeatPlannerLog_(className, logData, role) { SpreadsheetApp.openById('production'); }
function assertPlannerSession_(token) { return { role: 'teacher' }; }
function assertPlannerClass_(className) { if (!SEAT_PLANNER_SOURCE[className]) throw new Error('bad class'); }
`);
  fs.writeFileSync(path.join(root, "SeatPlannerUI.html"), `<!doctype html><body><div id="root"></div>
<script type="text/babel">
const {useState}=React;
function App(){
 const [className,setClassName]=useState("816"),[teacher,setTeacher]=useState(true),[token,setToken]=useState("");
 const teacherRole=true,authFailure=()=>{};
 const setupPassword=()=>{if(password.length<10){setError("請使用至少 10 個字元的密碼。");}};
 return <div><header><select><option value="801">801</option><option value="816">816</option></select></header>
  <div className={\`grid gap-4\`}><input placeholder="至少 10 個字元" /></div></div>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
</script></body>`);
  return root;
}

test("builds an isolated DEMO planner with the teacher panel", () => {
  const sourceDirectory = makeSourceFixture();
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "seat-planner-output-"));
  const result = buildSeatPlannerStagingBundle({
    sourceDirectory,
    outputDirectory,
    patchDirectory: makePatchFixture(),
    setupTokenHash: SETUP_TOKEN_HASH
  });

  assert.equal(result.mode, "demo");
  assert.ok(result.files.includes("SeatPlannerApi.gs"));
  assert.ok(result.files.includes("Code.gs"));
  assert.equal(result.files.includes("程式碼.gs"), false);
  assert.equal(result.files.includes("Index701.html"), false);
  assert.equal(result.files.includes("Index716.html"), false);

  const entryPoint = fs.readFileSync(path.join(outputDirectory, "Code.gs"), "utf8");
  assert.doesNotMatch(entryPoint, /SpreadsheetApp/);
  assert.match(entryPoint, /createSeatPlannerOutput_/);
  assert.match(entryPoint, /function authorizeFluencyStaging\(\)/);
  assert.match(entryPoint, /PropertiesService\.getScriptProperties/);
  assert.match(entryPoint, /UrlFetchApp\.fetch\('https:\/\/fluency-challenge-staging\.netlify\.app\/'/);

  const server = fs.readFileSync(path.join(outputDirectory, "SeatPlanner.gs"), "utf8");
  assert.match(server, /'DEMO'.*DEMO_ONLY/s);
  assert.match(server, /Demo Student 01/);
  assert.match(server, new RegExp(`setupTokenHash: '${SETUP_TOKEN_HASH}'`));
  assert.match(server, /minimumPasswordLength: 8/);
  assert.doesNotMatch(server, /minimumPasswordLength: 10/);
  assert.doesNotMatch(server, /openById\('production'\)/);
  assert.match(server, /demo mode never writes to the production roster Sheet/);

  const api = fs.readFileSync(path.join(outputDirectory, "SeatPlannerApi.gs"), "utf8");
  assert.match(api, /schoolYear: '9999'/);
  assert.doesNotMatch(api, /schoolYear: '115'/);

  const ui = fs.readFileSync(path.join(outputDirectory, "SeatPlannerUI.html"), "utf8");
  assert.equal((ui.match(/function FluencyPanel\(/g) || []).length, 1);
  assert.match(ui, /useState\("DEMO"\)/);
  assert.match(ui, /DEMO 隔離測試班/);
  assert.match(ui, /password\.length<8/);
  assert.match(ui, /至少 8 個字元/);
  assert.doesNotMatch(ui, /至少 10 個字元/);
  assert.match(ui, /teacherRole&&teacher&&.*<FluencyPanel/s);
  assert.ok(ui.indexOf("function FluencyPanel(") < ui.indexOf("function App(){"));
});

test("refuses to merge the panel twice", () => {
  const sourceDirectory = makeSourceFixture();
  const uiPath = path.join(sourceDirectory, "SeatPlannerUI.html");
  fs.writeFileSync(uiPath, fs.readFileSync(uiPath, "utf8").replace("function App(){", "function FluencyPanel(){}\nfunction App(){"));
  assert.throws(() => buildSeatPlannerStagingBundle({
    sourceDirectory,
    outputDirectory: fs.mkdtempSync(path.join(os.tmpdir(), "seat-planner-output-")),
    patchDirectory: makePatchFixture(),
    setupTokenHash: SETUP_TOKEN_HASH
  }), /already contains FluencyPanel/);
});
