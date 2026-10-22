import { createAssessmentResult } from "../apps/fluency-challenge/lib/assessment-contract.mjs";
import { AssessmentProviderError } from "./azure-pronunciation-assessor.mjs";

const DEFAULT_TIMEOUT_MS = 46_000;

export function createAzureContinuousPronunciationAssessor(options = {}) {
  const {
    key,
    region,
    timeoutMs,
    loadSdk = loadNodeSpeechSdk
  } = options;
  if (typeof key !== "string" || key.length < 16 || !/^[a-z0-9-]+$/i.test(String(region || ""))) {
    throw new TypeError("Azure Speech configuration is invalid");
  }

  return async function assessPronunciation(input) {
    if (!(input?.audio instanceof ArrayBuffer)) throw new TypeError("audio must be an ArrayBuffer");
    if (!Number.isInteger(input.durationMs) || input.durationMs < 1) {
      throw new TypeError("durationMs is invalid");
    }
    const mode = input.mode === "scripted" ? "scripted" : "unscripted";
    if (mode !== "unscripted") throw new TypeError("Continuous scripted assessment is not configured");

    let sdk;
    try {
      sdk = await loadSdk();
    } catch {
      throw new AssessmentProviderError("PROVIDER_SDK_UNAVAILABLE", "Assessment service unavailable.");
    }

    let recognizer;
    let audioConfig;
    let pronunciationConfig;
    try {
      const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
      speechConfig.speechRecognitionLanguage = "en-US";
      speechConfig.outputFormat = sdk.OutputFormat.Detailed;
      speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "1500");
      audioConfig = sdk.AudioConfig.fromWavFileInput(Buffer.from(input.audio));
      recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      pronunciationConfig = new sdk.PronunciationAssessmentConfig(
        "",
        sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdk.PronunciationAssessmentGranularity.Word,
        false
      );
      pronunciationConfig.enableProsodyAssessment = true;
      pronunciationConfig.applyTo(recognizer);
    } catch {
      closeQuietly_(recognizer, audioConfig, pronunciationConfig);
      throw new AssessmentProviderError("PROVIDER_CONFIGURATION_FAILED", "Assessment service unavailable.");
    }

    const segments = await collectSegments_(sdk, recognizer, timeoutMs ?? Math.max(DEFAULT_TIMEOUT_MS, input.durationMs + 20_000)).finally(() => {
      closeQuietly_(recognizer, audioConfig, pronunciationConfig);
    });
    return aggregateSegments_(segments, input.durationMs);
  };
}

function collectSegments_(sdk, recognizer, timeoutMs) {
  return new Promise((resolve, reject) => {
    const segments = [];
    let settled = false;
    const timer = setTimeout(() => finish(new AssessmentProviderError(
      "PROVIDER_TIMEOUT", "Assessment service unavailable."
    )), timeoutMs);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { recognizer.stopContinuousRecognitionAsync(() => {}, () => {}); } catch { /* closing below */ }
      if (error) reject(error);
      else resolve(segments);
    }

    recognizer.recognized = (_sender, event) => {
      if (settled || event?.result?.reason !== sdk.ResultReason.RecognizedSpeech) return;
      try {
        const raw = event.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
        const payload = JSON.parse(raw);
        const best = payload?.NBest?.[0];
        if (payload?.RecognitionStatus !== "Success" || !best?.PronunciationAssessment) return;
        segments.push({
          text: best.Display || payload.DisplayText || event.result.text || "",
          confidence: best.Confidence,
          scores: best.PronunciationAssessment,
          words: Array.isArray(best.Words) ? best.Words : []
        });
      } catch {
        finish(new AssessmentProviderError("PROVIDER_INVALID_RESPONSE", "Assessment service unavailable."));
      }
    };
    recognizer.canceled = (_sender, event) => {
      if (event?.reason === sdk.CancellationReason.Error) {
        const auth = event.errorCode === sdk.CancellationErrorCode?.AuthenticationFailure || event.errorCode === sdk.CancellationErrorCode?.Forbidden;
        const limited = event.errorCode === sdk.CancellationErrorCode?.TooManyRequests;
        finish(transportError(event.errorDetails, auth ? "PROVIDER_AUTH_FAILED" : limited ? "PROVIDER_RATE_LIMITED" : "PROVIDER_CONNECTION_FAILED"));
      }
    };
    recognizer.sessionStopped = () => finish();
    try {
      recognizer.startContinuousRecognitionAsync(
        () => {},
        (error) => finish(transportError(error, "PROVIDER_START_FAILED"))
      );
    } catch {
      finish(new AssessmentProviderError("PROVIDER_UNAVAILABLE", "Assessment service unavailable."));
    }
  });
}

export function aggregateContinuousSegments(segments, durationMs) {
  return aggregateSegments_(segments, durationMs);
}

function aggregateSegments_(segments, durationMs) {
  if (!segments.length) {
    throw new AssessmentProviderError("SPEECH_NOT_RECOGNIZED", "Speech was not recognized.", 422);
  }
  const words = segments.flatMap((segment) => segment.words);
  const validWords = words.filter((word) => word?.Word && word?.PronunciationAssessment?.ErrorType !== "Insertion");
  const accuracyValues = validWords.map((word) => finiteScore_(word.PronunciationAssessment?.AccuracyScore))
    .filter((score) => score !== null);
  const prosodyValues = segments.map((segment) => finiteScore_(segment.scores?.ProsodyScore))
    .filter((score) => score !== null);
  const offsets = validWords.map((word) => Number(word.Offset)).filter(Number.isFinite);
  const ends = validWords.map((word) => Number(word.Offset) + Number(word.Duration))
    .filter(Number.isFinite);
  const spokenTicks = validWords.reduce((sum, word) => {
    const ticks = Number(word.Duration);
    return sum + (Number.isFinite(ticks) && ticks > 0 ? ticks : 0);
  }, 0);
  if (validWords.length < 3 || !accuracyValues.length || !offsets.length || !ends.length) {
    throw new AssessmentProviderError("PROVIDER_INVALID_RESPONSE", "Assessment service unavailable.");
  }
  const speechSpan = Math.max(...ends) - Math.min(...offsets);
  if (!Number.isFinite(speechSpan) || speechSpan <= 0) {
    throw new AssessmentProviderError("PROVIDER_INVALID_RESPONSE", "Assessment service unavailable.");
  }
  const transcript = segments.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
  const confidencePairs = segments.map((segment) => ({
    confidence: Number(segment.confidence),
    weight: Math.max(1, segment.words.length)
  })).filter((item) => Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1);
  const confidenceWeight = confidencePairs.reduce((sum, item) => sum + item.weight, 0);
  const confidence = confidenceWeight
    ? confidencePairs.reduce((sum, item) => sum + item.confidence * item.weight, 0) / confidenceWeight
    : null;

  return createAssessmentResult({
    providerName: "azure-speech-pronunciation",
    providerVersion: "sdk-continuous-v1",
    mode: "unscripted",
    transcript,
    transcriptConfidence: confidence,
    transcriptSource: "pronunciation-assessment",
    durationMs,
    accuracy: mean_(accuracyValues),
    // Microsoft’s continuous sample recalculates whole-recording fluency from
    // spoken word durations divided by the first-to-last-word time span.
    fluency: Math.min(100, spokenTicks / speechSpan * 100),
    prosody: prosodyValues.length ? mean_(prosodyValues) : undefined,
    words: validWords.map((word) => ({
      word: word.Word,
      accuracy: word.PronunciationAssessment?.AccuracyScore,
      errorType: word.PronunciationAssessment?.ErrorType || "None"
    }))
  });
}

function finiteScore_(value) {
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

function mean_(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function closeQuietly_(...resources) {
  for (const resource of resources) {
    try { resource?.close?.(); } catch { /* no sensitive SDK details in logs */ }
  }
}


// Node 22+ exposes a browser-style global WebSocket. Speech SDK 1.51 otherwise
// selects that transport and loses the authentication headers it needs.
// Pin the SDK's supported Node transport instead of changing globalThis.
export async function loadNodeSpeechSdk() {
  const [sdk, { WebsocketMessageAdapter }] = await Promise.all([
    import("microsoft-cognitiveservices-speech-sdk"),
    import("microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common.browser/WebsocketMessageAdapter.js")
  ]);
  WebsocketMessageAdapter.forceNpmWebSocket = true;
  return sdk;
}


function transportError(details, fallback) {
  const text = typeof details === "string" ? details : String(details?.message || "");
  const code = /\b401\b|\b403\b/.test(text) ? "PROVIDER_AUTH_FAILED"
    : /\b429\b/.test(text) ? "PROVIDER_RATE_LIMITED"
    : /Dynamic require|require is not defined|not supported/.test(text) ? "PROVIDER_RUNTIME_INCOMPATIBLE"
    : /ENOTFOUND|EAI_AGAIN/.test(text) ? "PROVIDER_DNS_FAILED"
    : /ETIMEDOUT|timed out/i.test(text) ? "PROVIDER_NETWORK_TIMEOUT"
    : /certificate|CERT_|TLS|SSL/.test(text) ? "PROVIDER_TLS_FAILED" : fallback;
  return new AssessmentProviderError(code, "Assessment service unavailable.");
}
