import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canRetryAssessment,
  createAssessmentForm
} from "../apps/fluency-challenge/lib/assessment-retry.mjs";

test("transient assessment failures can resend the same recording", () => {
  for (const status of [null, 408, 429, 500, 503]) {
    assert.equal(canRetryAssessment(status), true, String(status));
  }
  for (const status of [200, 400, 401, 409, 413, 422]) {
    assert.equal(canRetryAssessment(status), false, String(status));
  }
});

test("a resend preserves the attempt ID, round, and audio bytes", async () => {
  const audio = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });
  const input = {
    attemptId: "14e4afc3-90c5-425d-93e3-32f0ea430000",
    assignmentId: "b9051cde-147a-491a-a369-026c25030000",
    unitId: "B3U1",
    round: 2,
    audio
  };
  const first = createAssessmentForm(input);
  const retry = createAssessmentForm(input);
  assert.equal(first.get("attemptId"), retry.get("attemptId"));
  assert.equal(first.get("round"), retry.get("round"));
  assert.deepEqual(
    new Uint8Array(await first.get("audio").arrayBuffer()),
    new Uint8Array(await retry.get("audio").arrayBuffer())
  );
});

test("the student UI keeps a recording only for an explicit same-page retry", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../apps/fluency-challenge/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/fluency-challenge/app.mjs", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="discardRecordingButton"/);
  assert.match(app, /state\.pendingRecording = recording/);
  assert.match(app, /state\.pendingAttemptId = uuid_\(\)/);
  assert.match(app, /if \(state\.pendingRecording\) return submitPendingAssessment_\(\)/);
  assert.match(app, /response\?\.status === 409[\s\S]*?loadTask_/);
  assert.match(app, /function cleanupAudio_\(\)[\s\S]*?clearPendingRecording_\(\)/);
  assert.match(app, /錄音仍保留在此頁，請勿重新整理/);
});

test('background evaluation polls through slow and interrupted responses without uploading audio again', async () => {
  const {waitForAssessment} = await import('../apps/fluency-challenge/lib/assessment-retry.mjs');
  let calls = 0;
  const result = await waitForAssessment(new Response(null,{status:202}), {
    attemptId:'fixture-attempt', wait:async()=>{},
    fetchImpl:async(url,options)=>{
      assert.match(url,/attemptId=fixture-attempt/); assert.equal(options.body,undefined);
      calls++;
      if(calls===1)throw Error('offline moment');
      if(calls===2)return new Response(null,{status:504});
      if(calls<20)return new Response(null,{status:202});
      return Response.json({assessment:{transcript:'Hello class'}});
    }
  });
  assert.equal(result.status,200);assert.equal(calls,20);
});
test('background polling preserves final errors and stops after a bounded wait',async()=>{
  const {waitForAssessment}=await import('../apps/fluency-challenge/lib/assessment-retry.mjs');
  const options={attemptId:'fixture',wait:async()=>{}};
  const failed=await waitForAssessment(new Response(null,{status:202}),{...options,fetchImpl:async()=>Response.json({error:'bad audio'},{status:422})});
  assert.equal(failed.status,422);
  assert.equal(await waitForAssessment(new Response(null,{status:202}),{...options,maxPolls:2,fetchImpl:async()=>new Response(null,{status:202})}),null);
});
