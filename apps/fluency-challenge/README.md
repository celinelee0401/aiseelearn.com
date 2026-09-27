# Fluency Challenge

This directory contains the three-round speaking app. It uses the shared student PIN identity service, teacher-assigned S1–S4 tracks, per-unit timing overrides, frozen class-run assignments, and server-side Azure Speech assessment. The teacher's existing seat planner includes Fluency controls and per-round score details.

As of 2026-09-24, the classroom pilot uses <https://fluency-challenge-vercel.vercel.app/>. The older Netlify staging and production sites are separate deployments. Pushing this repository branch does **not** deploy the student app, migrate the database, or update the Apps Script teacher panel.

The source of truth for a run is its frozen assignment and timing snapshot. Students do not select their own track. Spoken audio is submitted through a server endpoint; Azure keys, student PINs, and service signing secrets must remain outside this repository.

To assemble a temporary Vercel deploy tree, run `node scripts/stage-fluency-vercel.mjs` from the repository root. `node scripts/stage-fluency-netlify.mjs` assembles the older isolated Netlify staging tree. Run the Fluency and seat-planner tests before any deployment. The production SQL bundle is a reviewed candidate only; its checks do not authorize applying it to a live database.

For architecture and classroom readiness details, see [`docs/fluency-challenge-architecture-v0.1.md`](../../docs/fluency-challenge-architecture-v0.1.md) and [`docs/fluency-classroom-readiness-2026-09-19.md`](../../docs/fluency-classroom-readiness-2026-09-19.md). The latter is a dated checkpoint, not a current go-live approval.
