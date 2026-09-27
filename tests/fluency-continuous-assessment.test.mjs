import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateContinuousSegments,
  createAzureContinuousPronunciationAssessor
} from "../gateway/azure-continuous-pronunciation-assessor.mjs";
import { AssessmentProviderError } from "../gateway/azure-pronunciation-assessor.mjs";

const KEY = "FIC-AZURE-SPEECH-KEY-000000000000";

function segment(text, offset, accuracy, prosody, confidence = 0.9) {
  const word = text.replace(/[^A-Za-z]/g, "");
  return {
    text,
    confidence,
    scores: { ProsodyScore: prosody },
    words: [{
      Word: word,
      Offset: offset,
      Duration: 5_000_000,
      PronunciationAssessment: { AccuracyScore: accuracy, ErrorType: "None" }
    }]
  };
}

test("continuous assessment aggregates every recognized segment and clears the short-audio review", () => {
  const result = aggregateContinuousSegments([
    segment("Hello.", 10_000_000, 80, 70, 0.8),
    segment("Class.", 110_000_000, 90, 90, 0.9),
    segment("Today.", 250_000_000, 70, 80, 0.7)
  ], 35_000);
  assert.equal(result.provider.version, "sdk-continuous-v1");
  assert.equal(result.transcript, "Hello. Class. Today.");
  assert.equal(result.recognizedWordCount, 3);
  assert.equal(result.metrics.pronunciationAccuracy.score, 80);
  assert.equal(result.metrics.prosody.score, 80);
  assert.equal(result.metrics.pauseFlow.score, 6.1);
  assert.equal(result.metrics.evidenceReliability.scores.status, "measured");
  assert.equal(result.warnings.includes("assessment_requires_review"), false);
});

test("continuous assessment rejects empty or incomplete provider evidence", () => {
  assert.throws(() => aggregateContinuousSegments([], 35_000),
    (error) => error instanceof AssessmentProviderError && error.code === "SPEECH_NOT_RECOGNIZED");
  assert.throws(() => aggregateContinuousSegments([{
    text: "Hi", confidence: 0.8, scores: {}, words: []
  }], 35_000), (error) => error instanceof AssessmentProviderError && error.code === "PROVIDER_INVALID_RESPONSE");
});

test("continuous SDK path waits for all recognized events before returning", async () => {
  const calls = [];
  class FakeRecognizer {
    startContinuousRecognitionAsync(success) {
      success();
      queueMicrotask(() => {
        for (const [word, offset] of [["Hello", 10_000_000], ["class", 110_000_000], ["today", 210_000_000]]) {
          this.recognized(null, { result: {
            reason: "recognized",
            text: word,
            properties: { getProperty: () => JSON.stringify({
              RecognitionStatus: "Success",
              NBest: [{
                Display: word,
                Confidence: 0.85,
                PronunciationAssessment: { ProsodyScore: 75 },
                Words: [{ Word: word, Offset: offset, Duration: 5_000_000,
                  PronunciationAssessment: { AccuracyScore: 84, ErrorType: "None" } }]
              }]
            }) }
          } });
        }
        this.sessionStopped();
      });
    }
    stopContinuousRecognitionAsync(success) { calls.push("stop"); success(); }
    close() { calls.push("close"); }
  }
  const sdk = {
    SpeechConfig: { fromSubscription: () => ({ setProperty() {}, speechRecognitionLanguage: "" }) },
    OutputFormat: { Detailed: "detailed" },
    PropertyId: { Speech_SegmentationSilenceTimeoutMs: "silence", SpeechServiceResponse_JsonResult: "json" },
    AudioConfig: { fromWavFileInput: () => ({ close() {} }) },
    SpeechRecognizer: FakeRecognizer,
    PronunciationAssessmentConfig: class {
      applyTo() { assert.equal(this.enableProsodyAssessment, true); calls.push("apply"); }
      close() {}
    },
    PronunciationAssessmentGradingSystem: { HundredMark: "hundred" },
    PronunciationAssessmentGranularity: { Word: "word" },
    ResultReason: { RecognizedSpeech: "recognized" },
    CancellationReason: { Error: "error" }
  };
  const assess = createAzureContinuousPronunciationAssessor({
    key: KEY, region: "eastasia", loadSdk: async () => sdk
  });
  const result = await assess({ audio: new ArrayBuffer(44), durationMs: 35_000, mode: "unscripted" });
  assert.equal(result.transcript, "Hello class today");
  assert.equal(calls[0], "apply");
  assert.equal(calls.includes("stop"), true);
  assert.equal(calls.includes("close"), true);
});
