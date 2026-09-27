import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEnhancedTranscript,
  createAssessmentResult
} from "../apps/fluency-challenge/lib/assessment-contract.mjs";
import { inspectPcm16Wav } from "../apps/fluency-challenge/lib/audio-quality.mjs";
import {
  AssessmentProviderError,
  createAzurePronunciationAssessor
} from "../gateway/azure-pronunciation-assessor.mjs";

const ENDPOINT = "https://fictional-speech.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1";
const KEY = "FIC-AZURE-SPEECH-KEY-000000000000";

test("unscripted results keep content coverage unassessed instead of inventing a score", () => {
  const result = createAssessmentResult({
    providerName: "fictional",
    providerVersion: "v1",
    mode: "unscripted",
    durationMs: 30_000,
    transcript: "I enjoy playing basketball after school",
    accuracy: 82.4,
    fluency: 76.1,
    prosody: undefined,
    completeness: 99,
    words: [
      { word: "I", accuracy: 92, errorType: "None" },
      { word: "enjoy", accuracy: 55, errorType: "Mispronunciation" },
      { word: "playing", accuracy: 84, errorType: "None" },
      { word: "basketball", accuracy: 80, errorType: "None" },
      { word: "after", accuracy: 88, errorType: "None" },
      { word: "school", accuracy: 91, errorType: "None" }
    ]
  });

  assert.equal(result.metrics.pace.wpm, 12);
  assert.equal(result.metrics.pace.score, null);
  assert.deepEqual(result.metrics.pauseFlow, { score: 76.1, status: "measured" });
  assert.deepEqual(result.metrics.pronunciationAccuracy, { score: 82.4, status: "measured" });
  assert.deepEqual(result.metrics.prosody, { score: null, status: "unavailable" });
  assert.deepEqual(result.metrics.contentCoverage, { score: null, status: "not-applicable" });
  assert.equal(result.warnings.includes("content_coverage_not_assessed"), true);
  assert.deepEqual(result.observations, [{ type: "pronunciation-check", word: "enjoy", score: 55 }]);
  assert.equal("overallScore" in result, false);
});

test("scripted mode may expose Azure completeness as content coverage", () => {
  const result = createAssessmentResult({
    mode: "scripted",
    durationMs: 20_000,
    transcript: "This is a reference",
    accuracy: 90,
    fluency: 80,
    completeness: 75
  });
  assert.deepEqual(result.metrics.contentCoverage, { score: 75, status: "measured" });
});

test("PCM WAV inspection verifies the exact Azure short-audio format", () => {
  const audio = makePcm16Wav_(2_000, 0.1);
  const quality = inspectPcm16Wav(audio);
  assert.equal(quality.status, "pass");
  assert.equal(quality.durationMs, 2_000);
  assert.equal(quality.sampleRate, 16_000);
  assert.equal(inspectPcm16Wav(new ArrayBuffer(12)).status, "invalid-format");
});

test("Azure adapter reads scores from the nested PronunciationAssessment object", async () => {
  let sent;
  const assess = createAzurePronunciationAssessor({
    endpoint: ENDPOINT,
    key: KEY,
    fetchImpl: async (url, options) => {
      sent = { url: String(url), options };
      return new Response(JSON.stringify({
        RecognitionStatus: "Success",
        NBest: [{
          Display: "I like science projects.",
          Confidence: 0.82,
          PronunciationAssessment: {
            AccuracyScore: 86.2,
            FluencyScore: 78.4,
            ProsodyScore: 71.5,
            CompletenessScore: 100
          },
          Words: [
            { Word: "I", PronunciationAssessment: { AccuracyScore: 95, ErrorType: "None" } },
            { Word: "like", PronunciationAssessment: { AccuracyScore: 88, ErrorType: "None" } },
            { Word: "science", PronunciationAssessment: { AccuracyScore: 52, ErrorType: "Mispronunciation" } },
            { Word: "projects", PronunciationAssessment: { AccuracyScore: 83, ErrorType: "None" } }
          ]
        }]
      }), { status: 200 });
    }
  });

  const result = await assess({
    audio: makePcm16Wav_(20_000, 0.1),
    durationMs: 20_000,
    mode: "unscripted"
  });

  const header = JSON.parse(Buffer.from(sent.options.headers["Pronunciation-Assessment"], "base64").toString("utf8"));
  assert.equal(new URL(sent.url).searchParams.get("format"), "detailed");
  assert.equal(header.ReferenceText, undefined);
  assert.equal(header.EnableMiscue, undefined);
  assert.equal(result.metrics.pronunciationAccuracy.score, 86.2);
  assert.equal(result.metrics.pauseFlow.score, 78.4);
  assert.equal(result.metrics.contentCoverage.score, null);
  assert.deepEqual(result.metrics.evidenceReliability.transcript, {
    source: "pronunciation-assessment",
    confidence: 0.82,
    status: "measured"
  });
  assert.equal(result.observations[0].word, "science");
});

test("enhanced transcript replaces WPM evidence and marks low-confidence text for review", () => {
  const base = createAssessmentResult({
    providerName: "azure-speech-pronunciation",
    providerVersion: "rest-short-audio-v1",
    mode: "unscripted",
    durationMs: 20_000,
    transcript: "Wrong words",
    transcriptConfidence: 0.8,
    accuracy: 82,
    fluency: 78,
    prosody: 71
  });
  const result = applyEnhancedTranscript(base, {
    transcript: "These are the six words I said",
    wordCount: 7,
    confidence: 0.61,
    source: "azure-fast-transcription"
  });
  assert.equal(result.transcript, "These are the six words I said");
  assert.equal(result.recognizedWordCount, 7);
  assert.equal(result.metrics.pace.wpm, 21);
  assert.equal(result.metrics.pace.status, "review");
  assert.deepEqual(result.metrics.evidenceReliability.transcript, {
    source: "azure-fast-transcription",
    confidence: 0.61,
    status: "review"
  });
  assert.equal(result.warnings.includes("transcript_requires_review"), true);
});

test("short-audio pronunciation scores beyond 30 seconds are explicitly review-only", () => {
  const result = createAssessmentResult({
    providerName: "azure-speech-pronunciation",
    providerVersion: "rest-short-audio-v1",
    mode: "unscripted",
    durationMs: 35_000,
    transcript: "A longer response",
    transcriptConfidence: 0.9,
    accuracy: 82,
    fluency: 78,
    prosody: 71
  });
  assert.deepEqual(result.metrics.evidenceReliability.scores, {
    status: "review",
    reasons: ["short_audio_over_30_seconds"]
  });
  assert.equal(result.warnings.includes("assessment_requires_review"), true);
});

test("Azure adapter sends reference text only for explicitly scripted tasks", async () => {
  let header;
  const assess = createAzurePronunciationAssessor({
    endpoint: ENDPOINT,
    key: KEY,
    fetchImpl: async (_url, options) => {
      header = JSON.parse(Buffer.from(options.headers["Pronunciation-Assessment"], "base64").toString("utf8"));
      return new Response(JSON.stringify({
        RecognitionStatus: "Success",
        NBest: [{
          Display: "Read me",
          PronunciationAssessment: { AccuracyScore: 90, FluencyScore: 91, CompletenessScore: 92 },
          Words: []
        }]
      }), { status: 200 });
    }
  });
  const result = await assess({
    audio: makePcm16Wav_(2_000, 0.1),
    durationMs: 2_000,
    mode: "scripted",
    referenceText: "Read me"
  });
  assert.equal(header.ReferenceText, "Read me");
  assert.equal(header.EnableMiscue, "True");
  assert.equal(result.metrics.contentCoverage.score, 92);
});

test("Azure provider errors are bounded and never disclose its response body", async () => {
  const assess = createAzurePronunciationAssessor({
    endpoint: ENDPOINT,
    key: KEY,
    fetchImpl: async () => new Response(JSON.stringify({
      RecognitionStatus: "NoMatch",
      error: { message: "FIC-SENSITIVE-UPSTREAM-DETAIL" }
    }), { status: 200 })
  });
  await assert.rejects(
    () => assess({ audio: makePcm16Wav_(2_000, 0.1), durationMs: 2_000 }),
    (error) => error instanceof AssessmentProviderError
      && error.code === "SPEECH_NOT_RECOGNIZED"
      && !error.message.includes("FIC-SENSITIVE")
  );
});

test("Azure adapter rejects non-Azure endpoints before sending student audio", () => {
  assert.throws(
    () => createAzurePronunciationAssessor({
      endpoint: "https://speech.attacker.invalid/speech/recognition/conversation/cognitiveservices/v1",
      key: KEY
    }),
    /configuration is invalid/
  );
});

test("Azure adapter classifies credential and quota failures without exposing the provider body", async () => {
  for (const [status, expectedCode] of [[401, "PROVIDER_AUTH_FAILED"], [429, "PROVIDER_RATE_LIMITED"]]) {
    const assess = createAzurePronunciationAssessor({
      endpoint: ENDPOINT,
      key: KEY,
      fetchImpl: async () => new Response(JSON.stringify({
        RecognitionStatus: "Error",
        message: "FIC-SENSITIVE-UPSTREAM-DETAIL"
      }), { status })
    });
    await assert.rejects(
      () => assess({ audio: makePcm16Wav_(2_000, 0.1), durationMs: 2_000 }),
      (error) => error instanceof AssessmentProviderError
        && error.code === expectedCode
        && !error.message.includes("FIC-SENSITIVE")
    );
  }
});

function makePcm16Wav_(durationMs, amplitude) {
  const sampleRate = 16_000;
  const sampleCount = Math.round(sampleRate * durationMs / 1000);
  const dataLength = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  ascii_(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  ascii_(view, 8, "WAVE");
  ascii_(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii_(view, 36, "data");
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(44 + index * 2, Math.round(Math.sin(index / 10) * amplitude * 32767), true);
  }
  return buffer;
}

function ascii_(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
