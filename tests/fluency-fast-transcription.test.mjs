import assert from "node:assert/strict";
import test from "node:test";

import {
  createAzureFastTranscriber,
  TranscriptionProviderError
} from "../gateway/azure-fast-transcriber.mjs";

const ENDPOINT = "https://fictional-speech.cognitiveservices.azure.com";
const KEY = "FIC-AZURE-SPEECH-KEY-000000000000";

test("fast transcription sends a bounded phrase list and returns transcript evidence", async () => {
  let sent;
  const transcribe = createAzureFastTranscriber({
    endpoint: ENDPOINT,
    key: KEY,
    fetchImpl: async (url, options) => {
      sent = { url: String(url), options };
      return new Response(JSON.stringify({
        durationMilliseconds: 20_000,
        combinedPhrases: [{ text: "I visited Australia during summer vacation." }],
        phrases: [{
          text: "I visited Australia during summer vacation.",
          confidence: 0.83,
          durationMilliseconds: 18_000,
          words: ["I", "visited", "Australia", "during", "summer", "vacation"].map((text) => ({ text }))
        }]
      }), { status: 200 });
    }
  });

  const result = await transcribe({
    audio: new ArrayBuffer(44),
    phrases: ["Australia", "summer vacation", "Australia", ""]
  });
  const definition = JSON.parse(sent.options.body.get("definition"));
  assert.equal(new URL(sent.url).pathname, "/speechtotext/transcriptions:transcribe");
  assert.equal(new URL(sent.url).searchParams.get("api-version"), "2025-10-15");
  assert.deepEqual(definition.locales, ["en-US"]);
  assert.deepEqual(definition.phraseList.phrases, ["Australia", "summer vacation"]);
  assert.equal(result.transcript, "I visited Australia during summer vacation.");
  assert.equal(result.wordCount, 6);
  assert.equal(result.confidence, 0.83);
});

test("fast transcription rejects non-Azure endpoints before sending audio", () => {
  assert.throws(
    () => createAzureFastTranscriber({ endpoint: "https://attacker.invalid", key: KEY }),
    /configuration is invalid/
  );
});

test("fast transcription provider errors are bounded", async () => {
  const transcribe = createAzureFastTranscriber({
    endpoint: ENDPOINT,
    key: KEY,
    fetchImpl: async () => new Response(JSON.stringify({ detail: "FIC-SENSITIVE" }), { status: 429 })
  });
  await assert.rejects(
    () => transcribe({ audio: new ArrayBuffer(44) }),
    (error) => error instanceof TranscriptionProviderError
      && error.code === "TRANSCRIPTION_RATE_LIMITED"
      && !error.message.includes("FIC-SENSITIVE")
  );
});
