# Seat Planner private API patch

Current integration target: `115-1 課堂紀錄` (801/816). The earlier
`114-2 課堂紀錄` project is left unchanged.

`SeatPlannerApi.gs` is the canonical API source merged into the 115-1 project
alongside its existing `SeatPlanner.gs`. It deliberately reuses
`SEAT_PLANNER_SOURCE` and `readPlannerSeed_()` so the 115 roster Sheet remains
the single source of truth. Run `scripts/prepare-seat-planner-1151.mjs` against
a fresh `clasp clone` before deploying; do not paste the patch into an old
semester's project.

## Contract

The endpoint accepts only `getStudentTrack` in a signed server-to-server wrapper. It returns one active student's `schoolYear`, `classCode`, `seatNumber`, and `track`. It never returns a name, score, Speak Out value, seat layout, or class roster.

Required Script Properties, with values generated outside source control:

- `FLUENCY_SEAT_API_HMAC_SECRET_CURRENT`
- `FLUENCY_SEAT_API_HMAC_SECRET_PREVIOUS` during a bounded key rotation only
- `FLUENCY_RUN_SERVICE_URL`
- `FLUENCY_TEACHER_SERVICE_URL`
- `FLUENCY_RUN_API_HMAC_SECRET_CURRENT`

The matching current secret is stored only in the Fluency server environment. Do not put either secret in browser JavaScript, Git, an Obsidian note, or a public Google Sheet.

`FLUENCY_RUN_SERVICE_URL` points to `/api/internal/fluency-runs`; `FLUENCY_TEACHER_SERVICE_URL` points to `/api/internal/fluency-teacher`. Both accept only HMAC-signed requests from Apps Script.

## Teacher panel integration

`SeatPlannerFluencyPanel.html` is a staged React/Babel component for the existing `SeatPlannerUI.html`. Its component must be defined **before** the existing script calls `ReactDOM.createRoot(...).render(...)`. The simplest merge is to copy the code between its `<script>` tags into the existing `text/babel` block before `function App()`. If the Apps Script project uses server-side HTML partials, include the whole file before the main `text/babel` script instead. Then render this inside the authenticated teacher view:

```jsx
<FluencyPanel
  className={className}
  token={token}
  onAuthFailure={authFailure}
/>
```

The component calls only these server functions:

- `getFluencyUnitSettings(className, unitId, token)`
- `saveFluencyUnitSettings(className, unitId, settings, token, requestId)`
- `startFluencyRunSnapshot(className, unitId, token, requestId)`
- `getFluencyRunProgress(className, unitId, token)`
- `closeFluencyRun(className, unitId, token, requestId)`

Every function revalidates the existing planner session and class on the server. The assistant role is rejected before any outbound request. The progress payload contains seat numbers and R1-R3 evidence only; it omits names, UUIDs, tracks, transcripts, and audio links.

Only one open run may exist for the same school year, class, and unit. Repeated Start clicks reuse the original snapshot instead of creating duplicate assignments. Closing a run changes it to `closed`; the existing student task and attempt RPCs already require `open`, so stale student pages can no longer submit a new round.

## Deployment status

On 2026-09-19, the 115-1 project received the canonical API, Fluency teacher
panel, and a planner-only `doGet` entry point. Its web-app deployment has ID
`AKfycbzTdL2i6fwwprBgBUuM-qDfJgCr9wl7gvp8Vctl9sdI5YPjDuFy5rQkm8YmQ9gHUTGl`.
Version 3 (2026-09-24) adds a click/tap-accessible three-round score panel
to the teacher's seat-progress cards. It displays WPM, pause flow,
pronunciation accuracy, and prosody from the existing teacher progress API;
the student app, identity flow, and score storage were not changed.
The owner authorized the newly copied project and the public entry now returns
HTTP 200. Version 2 changed only the one-time setup-token hash; the owner then
configured teacher and assistant passwords. The one-time token is not stored
in this repository. Authenticated read-only checks loaded both 801 and 816
rosters and their S1–S4 placements. A read-only B2U3 unit load failed with
`Fluency Challenge 讀取單元設定服務尚未完成設定`, confirming that the 115-1 Fluency
Script Properties and production service integration are still missing. This
URL is **not yet a verified Fluency classroom entry**.

The roster source is the separate `115 G8` spreadsheet ID
`11_p5iPuq2aj43hu6AZM9VrpVz41jH-oMWbZyDOm8p50`, using tabs `801_名單`
and `816_名單`; the newly copied `115-1 課堂紀錄` workbook is not the planner's
roster source.

The live `114-2 課堂紀錄` project remains unchanged. An isolated project named
`Fluency Challenge Seat Planner Staging` was created on 2026-09-04. Version 4,
deployed on 2026-09-05, contains only the five demo-bundle files, uses the
isolated school year `9999`, and has a staging-only one-time teacher setup-token
hash. Its web-app deployment is:

<https://script.google.com/macros/s/AKfycbyHtTeZ7kIXcyZppqLQHF7534C_jcxBYKWuOWVr2EmkgvtFrEimYXvSoHBz1sexC5qT/exec>

Both Netlify endpoint properties and both HMAC secrets are stored as Apps Script
properties, and the owner scopes have been authorized. The public page returns
HTTP 200; signed DEMO lookups return S1-S4 for seats 1-4; and the reverse
Apps Script -> Netlify -> Supabase check opens a four-assignment B2U3 run and
reads the effective timing rules. The production planner remains unchanged.
The teacher password itself still must be entered by the owner through the
one-time setup page; it is never generated, viewed, or stored by the build tool.

On 2026-10-11 the redesigned teacher Fluency panel (step bar, run-status badge,
collapsible settings with validation, class progress summary and filters,
compact seat cards, and a round-comparison score table) replaced only the
`FluencyPanel` block in the staging project and was deployed as staging
version 7 on the same deployment ID. Later the same day, after the owner's explicit approval,
the panel was restored to the 115-1 production planner (script ID
`1DzstRGyv5iun4d4D3vmsTBNdh4Td2Eb0AnKg1dL1rJZTQyqvuSLa3aKC`). Its version 6
(「討論座形與同軌桌調整」) had overwritten `SeatPlannerUI.html` without the
panel. Only the panel was merged with `mergeTeacherPanel()` (additions only;
other files byte-identical) and deployed as version 7 on the same deployment
ID. Re-merge the panel whenever the planner UI is redeployed.

On 2026-10-11 (evening) the 115-1 planner also received `fluencyDatabaseKeepAlive()`
and `installFluencyKeepAliveTrigger()` (deployment version 8). The keep-alive
sends one signed, read-only `getFluencyUnitSettings` lookup through the existing
production teacher service so the free-tier production Supabase project is not
paused after seven idle days. The owner must run `installFluencyKeepAliveTrigger`
once from the Apps Script editor to authorize and create the daily 06:00 trigger.

## Isolated staging bundle

`scripts/build-seat-planner-staging-bundle.mjs` merges this patch into an exported
copy of the real planner without changing that project. The generated bundle is
deliberately restricted to class `DEMO`, four fictional students, and no Google
Sheet roster or classroom-log writes. This lets the Apps Script-to-Netlify flow
be verified before any production deployment.

The builder also maps the isolated bundle to school year `9999`, matching the
fictional staging enrollments without changing the production API's `115`
contract.

The demo bundle also replaces the legacy scoreboard entry point and omits the
701/716 HTML files. Its deployed project therefore cannot fall through to the
production spreadsheet code by visiting the URL without `?view=planner`.

```sh
node scripts/build-seat-planner-staging-bundle.mjs \
  --source /tmp/exported-seat-planner \
  --output /tmp/fluency-seat-planner-staging \
  --patch gas/seat-planner-api \
  --setup-token-hash "$STAGING_TEACHER_SETUP_TOKEN_SHA256"
```

The output is a deployment artifact, not a new source of truth. Rebuild it from
the latest exported planner whenever the production UI changes.
The setup token itself must remain outside source control; only its SHA-256 hash
is passed to the builder.
