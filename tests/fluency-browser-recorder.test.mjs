import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inspectPcm16Wav } from "../apps/fluency-challenge/lib/audio-quality.mjs";
import { encodePcm16Wav, resampleMono } from "../apps/fluency-challenge/lib/browser-recorder.mjs";

test("browser PCM is resampled to the exact Azure input format", () => {
  const sourceRate = 48_000;
  const source = new Float32Array(sourceRate * 2);
  for (let index = 0; index < source.length; index += 1) source[index] = Math.sin(index / 20) * 0.1;
  const downsampled = resampleMono(source, sourceRate, 16_000);
  const wav = encodePcm16Wav(downsampled, 16_000);
  const quality = inspectPcm16Wav(wav);
  assert.equal(downsampled.length, 32_000);
  assert.equal(quality.status, "pass");
  assert.equal(quality.durationMs, 2_000);
  assert.equal(quality.sampleRate, 16_000);
  assert.equal(quality.channels, 1);
  assert.equal(quality.bitsPerSample, 16);
});

test("student UI uses shared identity and server assessment without exposing a roster or track", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../apps/fluency-challenge/index.html", import.meta.url), "utf8"),
    readFile(new URL("../apps/fluency-challenge/app.mjs", import.meta.url), "utf8")
  ]);
  assert.match(app, /\/api\/fluency\/auth\/login/);
  assert.match(app, /\/api\/fluency\/task/);
  assert.match(app, /\/api\/fluency\/assess/);
  assert.match(app, /new PcmWavRecorder/);
  assert.match(app, /getRecordingTimerState/);
  assert.match(app, /firstIncompleteRoundIndex/);
  assert.match(app, /completedAttempts/);
  assert.match(app, /mergeRoundResults/);
  assert.match(app, /上一輪已經完成，已為你進入下一輪/);
  assert.match(app, /請說完這一句/);
  assert.match(app, /最多 3 秒後自動停止/);
  assert.match(app, /state\.session\.seatNumber\} 號 · \$\{state\.task\.unitId\}/);
  assert.match(app, /elements\.roundBadge\.textContent = "三輪完成"/);
  assert.match(app, /step\.classList\.remove\("active"\)/);
  assert.doesNotMatch(app, /SpeechRecognition|webkitSpeechRecognition/);
  assert.doesNotMatch(`${html}\n${app}`, /STUDENT_DATA|studentSelect|displayStudentName/);
  assert.doesNotMatch(`${html}\n${app}`, /\bS[1-4]\b/);
  assert.match(html, /完成並登出/);
});
