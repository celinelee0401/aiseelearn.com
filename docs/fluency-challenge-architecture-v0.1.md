# Fluency Challenge architecture v0.1

Date: 2026-09-03

## Confirmed teacher rules

- S1 and S2 default to 35, 30, and 25 seconds.
- S3 and S4 default to 30, 25, and 20 seconds.
- Every unit may override one or more track schedules without changing the global defaults.
- The teacher assigns the track. The student does not choose it.
- Opening a class run freezes an assignment snapshot containing the student identity reference, unit, track, exact round limits, configuration version, and assignment time.

## Shared student identity

The self-correction center remains the single source of truth for student identity. A student chooses one six-digit PIN during first activation. Fluency Challenge does not copy or store the PIN or PIN hash.

```text
Fluency browser
  -> same-origin Netlify login function
  -> signed server-to-server identity request
  -> shared Supabase enrollment and PIN verifier
  -> encrypted, HttpOnly Fluency session cookie
```

The signed request uses HMAC-SHA-256, a 90-second clock window, and a hashed one-time nonce marker. The browser never receives Supabase keys, HMAC keys, stable student UUIDs, enrollment UUIDs, raw nonces, PIN hashes, or activation-code hashes.

Because the production students have not activated accounts yet, first activation is supported through either the self-correction center or Fluency Challenge. Both routes update the same enrollment record, so the student creates only one PIN.

## Data ownership

- `students` is the stable anonymous identity.
- `enrollments` owns school year, class, seat number, activation state, and PIN hash.
- the interactive seat planner owns the current teacher-assigned S-track;
- `fluency_unit_track_rules` owns teacher-edited per-unit timing overrides;
- `fluency_assignments.assignment_snapshot` owns the historical track and exact timing used for one class run;
- `fluency_attempts` owns one server-accepted result per round.

The seat planner integration must be a single-student server-to-server lookup. It must never expose the class roster or a public browser-readable roster endpoint.

## Assessment direction

The old browser implementation used Web Speech API output for all scoring. Its so-called clarity score was a recognized-word count divided by an expected count, so a speech-recognition miss reduced both fluency and clarity even when the student spoke well.

The old third label was **Clarity**. The rebuild does not preserve that formula. It uses a versioned evidence contract with distinct measures for:

- pace: recognized WPM, reported as a measure but not converted into a grade until classroom thresholds are validated;
- pause flow: Azure `FluencyScore` when available;
- pronunciation accuracy: Azure `AccuracyScore` when available, shown to students as 「發音清晰」 rather than overclaiming a general intelligibility score;
- prosody: a separate, optional measure, never copied from fluency when Azure omits it;
- content coverage: deliberately `not-applicable` for free speech and only available when a task has an exact reference script.

The first provider adapter targets Azure Speech Pronunciation Assessment's short-audio REST endpoint. Fluency Challenge uses **unscripted** mode because students speak about a prompt rather than read a fixed script. The adapter reads Azure's nested `PronunciationAssessment` object, accepts only 16 kHz mono PCM WAV, and performs an audio-quality check before a paid provider call. It returns evidence rather than an invented overall score. Raw browser heuristics are not authoritative grades.

Every assessment request must first resume the encrypted student session and reload the frozen assignment. The submitted assignment ID, unit, round number, and audio duration must agree with that snapshot. At the target time, the student receives a fixed three-second finish-the-current-sentence window before automatic stop. Server validation permits one additional second only for recorder/clock tolerance; stale assignments and recordings beyond that bounded allowance are rejected before the provider call.

After successful assessment, Netlify sends a second signed request to the central service. The central database rechecks the student, enrollment, assignment, open-run state, round, and frozen time limit before inserting the attempt. A browser-generated UUID is reused as the request ID, so an identical retry returns the existing attempt while a different submission cannot overwrite the same round.

## Implemented in this slice

- shared credential verification and activation functions in the self-correction center;
- signed internal student identity endpoint with replay protection;
- same-origin Netlify login adapter with an encrypted 45-minute Fluency session;
- data-driven four-track schedule resolver;
- immutable assignment snapshot builder;
- Supabase migrations for identity replay markers and Fluency core tables;
- fictional-data tests for identity secrecy, activation, timing overrides, and snapshots;
- a locally staged `SeatPlannerApi.gs` patch that reuses the real planner's `readPlannerSeed_()` data path;
- signed single-student track lookup with no name, score, Speak Out value, or roster response;
- teacher-only class-run creation from the existing authenticated planner session;
- one atomic database transaction that resolves active enrollments, applies global/unit timing rules, and freezes every assignment;
- authenticated student task loading that returns only the public prompt and three frozen round limits, without an S-track label;
- a provider-neutral assessment result contract that keeps missing metrics as `null` instead of substituting zero or another score;
- 16 kHz mono PCM WAV validation with short, quiet, and clipping quality gates;
- an Azure unscripted-pronunciation adapter that reads nested scores and bounds provider failures;
- an authenticated Netlify assessment route that checks the frozen assignment and round before any paid assessment call;
- a signed internal attempt endpoint and database RPC that persist one idempotent, server-validated evidence record per round.
- a roster-free student interface for shared-PIN login/activation, three frozen timed rounds, per-round playback and evidence, comparison, and explicit shared-iPad logout;
- a browser recorder that captures microphone PCM, resamples it to 16 kHz mono, and encodes a WAV accepted by the server quality gate and Azure short-audio endpoint.
- teacher-only unit settings read/write through the existing seat-planner session, with assistants rejected before any outbound request;
- an idempotent unit-settings RPC that preserves global defaults while allowing each unit to override any S1-S4 three-round schedule;
- a staged seat-planner React panel for editing the unit title, prompt, and timings, then opening a class run only after settings are saved;
- a seat-only progress API and teacher panel showing R1-R3 completion plus WPM, pause flow, pronunciation accuracy, and prosody when measured;
- progress responses deliberately omit student names, stable IDs, assigned tracks, transcripts, and audio locations.
- a one-open-run database constraint prevents duplicate snapshots for the same school year, class, and unit;
- repeated Start requests reuse the existing snapshot, while the teacher-only End action closes it idempotently;
- once closed, the existing task and attempt authorization paths reject further student recordings from stale browser pages.

## Staging deployment status (2026-09-08)

- An independent Netlify site is live at <https://fluency-challenge-staging.netlify.app>.
- The existing production Netlify site has not been linked, overwritten, or otherwise changed.
- Ten Fluency-only functions are deployed through an explicit allowlist: five browser-facing routes and five signed internal routes.
- A separate Supabase project (`doylqrgihieuwtwqrbwv`, Seoul) is healthy, contains the five reviewed migrations, and is connected only to the staging Netlify site.
- Session and HMAC secrets are stored as write-only Netlify production secrets and retained in macOS Keychain for the later Supabase seed and Apps Script integration. No secret is stored in the repository.
- The staging site now uses Azure Speech Pronunciation Assessment for real unscripted English recognition and evidence. The earlier site-name-locked `staging-flow-check` assessor remains available for deterministic flow verification, but it is no longer the active production-context mode on the staging site.
- The live end-to-end check completed all twelve submissions for four fictional students: S1/S2 use `35/30/25`, S3/S4 use `30/25/20`, and teacher progress reports all three rounds complete without invented scores.
- Focused local contract tests pass: 53 tests covering public routes, identity, timing, immutable snapshots, browser recording, assessment, attempt storage, teacher controls, staging isolation, the deterministic SQL bundle, the automated E2E verifier, and seat-planner integration.
- A repeatable staging packager and fictional S1-S4 seed/open-run scripts are present under `scripts/`.
- The one-command staging verifier now exercises first activation/shared PIN login, frozen per-track timing, all twelve synthetic round submissions, no-score staging assessment, and seat-only teacher progress against the live isolated stack.
- The five required SQL migrations now have a deterministic staging bundle: fixed dependency order, pinned SHA-256 review hashes, and a single transaction so a failure cannot leave a partially initialized database.
- `Fluency Challenge Seat Planner Staging` version 4 is live with class `DEMO`, school year `9999`, four fictional S1-S4 students, owner authorization, matching HMAC properties, and a staging-only one-time teacher setup-token hash. Its public page returns HTTP 200 and its signed single-student endpoint returns the expected S1-S4 assignments.
- The reverse integration is verified: Apps Script opens a four-assignment B2U3 run through Netlify, reads the effective four-track timing rules, and reaches the isolated Supabase project. A subsequent full student-flow verifier completed login, task retrieval, all twelve rounds, and teacher progress without fabricated scores.
- The staging teacher password has been set by the owner, and teacher login plus custom unit authoring have been exercised in the staged planner.
- Netlify staging deploy `6a9f592b5a5ea63daa974e56` adds a three-second finish-the-current-sentence grace period after each round target. The browser displays the actual recorded duration, while the server permits four seconds total overage: three seconds for the learner and one second for recorder/clock tolerance. The matching Supabase staging validation is active, and 19 focused timer, recorder, assessment, storage, task, and route tests pass.
- Netlify staging deploy `6a9f5df02e5d045521ef830b` hardens the Azure Speech boundary before activation: assessment requests are restricted to official Azure Speech hosts, provider authentication/rate-limit/timeout failures are classified without returning upstream details to students, and bounded diagnostics contain no audio, transcript, endpoint, or key. Twenty-eight focused tests pass.
- Netlify staging deploy `6a9f8bc4cf1341bad3622bbe` activates Azure assessment after the owner stored a production-context secret key and the East Asia short-audio recognition URL in Netlify. Twenty-three focused assessment, recorder, route, and timer tests pass; live checks return HTTP 200 for the B3U1 page, 400 for an invalid login payload, and 401 for unauthenticated session and assessment requests.
- Netlify staging deploy `6a9fe093d2ed821eda1499cb` and migration `202609080002_fluency_resume_progress.sql` fix round-resume state. The frozen task now returns only completed round numbers, the browser resumes at the first incomplete round after reload or device change, and duplicate/out-of-sequence rounds are rejected before Azure is called. Twenty-five focused tests pass. A live fictional-student check returned completed rounds `[1,2,3]`, rejected a duplicate with `round_already_completed`, and restored the three-round completion screen.
- Netlify staging deploy `6a9fea89a5d60493efdba9b0` and migration `202609080003_fluency_resume_evidence.sql` restore each completed round's saved duration, transcript, provider evidence, and measured metrics after reload or device change. The public response remains bound to the authenticated assignment and excludes student/enrollment IDs, track, run ID, and audio storage keys. Twenty-eight focused tests pass. A live fictional-student login restored all three detailed round rows and confirmed that historical no-score flow checks remain shown as `—` rather than fabricated scores.

## Not deployed yet

- Supabase migrations have not been applied to production;
- the staged seat planner API and teacher panel have not been added to or deployed from the live Apps Script project;
- Azure staging credentials are configured and one real B3U1 three-round recording flow has completed; broader multi-student recognition and score-calibration checks are still pending.

## 2026-09-03 read-only planner audit

The live Apps Script project was inspected without saving or deploying changes. It contains `程式碼.gs`, `SeatPlanner.gs`, and `SeatPlannerUI.html`; there was no existing `doPost` handler. The existing `readPlannerSeed_()` already normalizes the spaced headers, reads `座號`, `姓名`, `固定 G 組`, `目前 S 軌`, `座位`, `競賽分數`, `Speak Out`, and `是否在班`, and excludes inactive or incomplete rows. The new patch therefore calls that function rather than building a second roster parser.

## 2026-09-04 isolated planner staging

The real planner source was exported read-only and passed through a deterministic
staging builder. The builder injects the teacher-only Fluency controls, changes
the only class to `DEMO`, substitutes four fictional S1-S4 students, disables
roster and classroom-log writes, and removes the legacy 701/716 scoreboard entry
point. Version 4 is deployed at
<https://script.google.com/macros/s/AKfycbyHtTeZ7kIXcyZppqLQHF7534C_jcxBYKWuOWVr2EmkgvtFrEimYXvSoHBz1sexC5qT/exec>.
The bundle maps its fictional records to school year `9999`, stores the two
staging-only HMAC values as Apps Script properties, and has completed owner
authorization. Both directions of the Apps Script/Netlify connection and the
full fictional student flow are verified; the live production planner remains
unchanged.
