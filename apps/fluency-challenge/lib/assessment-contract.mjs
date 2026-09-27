export const ASSESSMENT_SCHEMA_VERSION = "1.0";
export const ASSESSMENT_RUBRIC_VERSION = "fluency-evidence-v0.2";
export const TRANSCRIPT_REVIEW_THRESHOLD = 0.7;
export const SHORT_AUDIO_LIMIT_MS = 30_000;

export function createAssessmentResult(input) {
  const mode = input?.mode === "scripted" ? "scripted" : "unscripted";
  const durationMs = integerInRange_(input?.durationMs, 1, 180_000, "durationMs");
  const transcript = typeof input?.transcript === "string" ? input.transcript.trim() : "";
  const words = normalizeWords_(input?.words);
  const recognizedWordCount = wordCountOrFallback_(input?.recognizedWordCount, words, transcript);
  const wpm = Math.round(recognizedWordCount / (durationMs / 60_000) * 10) / 10;
  const accuracy = scoreOrNull_(input?.accuracy);
  const fluency = scoreOrNull_(input?.fluency);
  const prosody = scoreOrNull_(input?.prosody);
  const completeness = mode === "scripted" ? scoreOrNull_(input?.completeness) : null;
  const transcriptConfidence = confidenceOrNull_(input?.transcriptConfidence);
  const transcriptSource = normalizeTranscriptSource_(input?.transcriptSource);
  const transcriptStatus = transcriptConfidence === null
    ? "unavailable"
    : transcriptConfidence < TRANSCRIPT_REVIEW_THRESHOLD ? "review" : "measured";
  const scoreReasons = [];
  if (String(input?.providerVersion || "") === "rest-short-audio-v1" && durationMs > SHORT_AUDIO_LIMIT_MS) {
    scoreReasons.push("short_audio_over_30_seconds");
  }

  const warnings = [];
  if (!transcript) warnings.push("no_transcript");
  if (accuracy === null) warnings.push("pronunciation_accuracy_unavailable");
  if (fluency === null) warnings.push("pause_flow_unavailable");
  if (prosody === null) warnings.push("prosody_unavailable");
  if (mode === "unscripted") warnings.push("content_coverage_not_assessed");
  if (transcriptConfidence === null) warnings.push("transcript_confidence_unavailable");
  if (transcriptStatus === "review") warnings.push("transcript_requires_review");
  if (scoreReasons.length) warnings.push("assessment_requires_review");

  return Object.freeze({
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    rubricVersion: ASSESSMENT_RUBRIC_VERSION,
    provider: Object.freeze({
      name: String(input?.providerName || "unknown"),
      version: String(input?.providerVersion || "unknown"),
      mode
    }),
    transcript,
    durationMs,
    recognizedWordCount,
    metrics: Object.freeze({
      pace: Object.freeze({ wpm, score: null, status: "measured" }),
      pauseFlow: metric_(fluency),
      pronunciationAccuracy: metric_(accuracy),
      prosody: metric_(prosody),
      contentCoverage: completeness === null
        ? Object.freeze({ score: null, status: mode === "unscripted" ? "not-applicable" : "unavailable" })
        : Object.freeze({ score: completeness, status: "measured" }),
      evidenceReliability: Object.freeze({
        transcript: Object.freeze({
          source: transcriptSource,
          confidence: transcriptConfidence,
          status: transcriptStatus
        }),
        scores: Object.freeze({
          status: scoreReasons.length ? "review" : "measured",
          reasons: Object.freeze(scoreReasons)
        })
      })
    }),
    observations: Object.freeze(lowAccuracyObservations_(words)),
    warnings: Object.freeze(warnings)
  });
}

export function applyEnhancedTranscript(result, input = {}) {
  if (!result || typeof result !== "object" || !result.metrics || typeof result.metrics !== "object") {
    throw new TypeError("assessment result is invalid");
  }
  const transcript = typeof input.transcript === "string" && input.transcript.trim()
    ? input.transcript.trim()
    : result.transcript;
  const recognizedWordCount = wordCountOrFallback_(input.wordCount, [], transcript);
  const confidence = confidenceOrNull_(input.confidence);
  const status = confidence === null
    ? "unavailable"
    : confidence < TRANSCRIPT_REVIEW_THRESHOLD ? "review" : "measured";
  const source = normalizeTranscriptSource_(input.source || "azure-fast-transcription");
  const wpm = Math.round(recognizedWordCount / (result.durationMs / 60_000) * 10) / 10;
  const priorReliability = result.metrics.evidenceReliability || {};
  const warnings = result.warnings.filter((warning) => ![
    "no_transcript",
    "transcript_confidence_unavailable",
    "transcript_requires_review",
    "enhanced_transcript_unavailable"
  ].includes(warning));
  if (!transcript) warnings.push("no_transcript");
  if (confidence === null) warnings.push("transcript_confidence_unavailable");
  if (status === "review") warnings.push("transcript_requires_review");
  return Object.freeze({
    ...result,
    transcript,
    recognizedWordCount,
    metrics: Object.freeze({
      ...result.metrics,
      pace: Object.freeze({ wpm, score: null, status: status === "review" ? "review" : "measured" }),
      evidenceReliability: Object.freeze({
        ...priorReliability,
        transcript: Object.freeze({ source, confidence, status })
      })
    }),
    warnings: Object.freeze([...new Set(warnings)])
  });
}

export function addAssessmentWarning(result, warning) {
  if (!result || typeof result !== "object" || typeof warning !== "string" || !warning) {
    throw new TypeError("assessment warning is invalid");
  }
  return Object.freeze({
    ...result,
    warnings: Object.freeze([...new Set([...(result.warnings || []), warning])])
  });
}

function normalizeWords_(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((word) => word && typeof word === "object")
    .map((word) => ({
      word: typeof word.word === "string" ? word.word.trim() : "",
      accuracy: scoreOrNull_(word.accuracy),
      errorType: typeof word.errorType === "string" ? word.errorType : "None"
    }))
    .filter((word) => word.word);
}

function countRecognizedWords_(words, transcript) {
  if (words.length) return words.filter((word) => word.errorType !== "Omission").length;
  return transcript.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
}

function wordCountOrFallback_(value, words, transcript) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0 && number <= 10_000) return number;
  return countRecognizedWords_(words, transcript);
}

function confidenceOrNull_(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) return null;
  return Math.round(number * 1_000) / 1_000;
}

function normalizeTranscriptSource_(value) {
  const source = String(value || "pronunciation-assessment").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(source) ? source : "pronunciation-assessment";
}

function lowAccuracyObservations_(words) {
  return words
    .filter((word) => word.errorType !== "Omission" && word.accuracy !== null && word.accuracy < 60)
    .sort((left, right) => left.accuracy - right.accuracy)
    .slice(0, 3)
    .map((word) => Object.freeze({
      type: "pronunciation-check",
      word: word.word,
      score: word.accuracy
    }));
}

function metric_(score) {
  return Object.freeze({ score, status: score === null ? "unavailable" : "measured" });
}

function scoreOrNull_(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.max(0, Math.min(100, number)) * 10) / 10;
}

function integerInRange_(value, min, max, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new TypeError(`${name} is invalid`);
  }
  return number;
}
