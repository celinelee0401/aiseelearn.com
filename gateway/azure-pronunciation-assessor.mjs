import { createAssessmentResult } from "../apps/fluency-challenge/lib/assessment-contract.mjs";

export class AssessmentProviderError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createAzurePronunciationAssessor(options = {}) {
  const {
    endpoint,
    key,
    fetchImpl = fetch,
    timeoutMs = 20_000
  } = options;
  const recognitionUrl = normalizeRecognitionUrl_(endpoint);
  if (!recognitionUrl || typeof key !== "string" || key.length < 16) {
    throw new TypeError("Azure Speech configuration is invalid");
  }

  return async function assessPronunciation(input) {
    const mode = input?.mode === "scripted" ? "scripted" : "unscripted";
    const referenceText = typeof input?.referenceText === "string" ? input.referenceText.trim() : "";
    if (mode === "scripted" && !referenceText) {
      throw new TypeError("referenceText is required in scripted mode");
    }
    if (!(input?.audio instanceof ArrayBuffer)) throw new TypeError("audio must be an ArrayBuffer");

    const pronunciationConfig = {
      GradingSystem: "HundredMark",
      Granularity: "Word",
      Dimension: "Comprehensive",
      EnableProsodyAssessment: "True",
      ...(mode === "scripted" ? { ReferenceText: referenceText, EnableMiscue: "True" } : {})
    };
    const url = new URL(recognitionUrl);
    url.searchParams.set("language", "en-US");
    url.searchParams.set("format", "detailed");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
          "Ocp-Apim-Subscription-Key": key,
          "Pronunciation-Assessment": Buffer.from(JSON.stringify(pronunciationConfig), "utf8").toString("base64")
        },
        body: input.audio,
        signal: controller.signal
      });
    } catch (error) {
      const code = error?.name === "AbortError" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE";
      throw new AssessmentProviderError(code, "Assessment service unavailable.");
    } finally {
      clearTimeout(timeoutId);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new AssessmentProviderError("PROVIDER_INVALID_RESPONSE", "Assessment service unavailable.");
    }
    const best = payload?.NBest?.[0];
    if (!response.ok || payload?.RecognitionStatus !== "Success" || !best) {
      throw providerResponseError_(response.status, payload?.RecognitionStatus);
    }

    const scores = best.PronunciationAssessment ?? best;
    const words = Array.isArray(best.Words) ? best.Words.map(normalizeAzureWord_) : [];
    return createAssessmentResult({
      providerName: "azure-speech-pronunciation",
      providerVersion: "rest-short-audio-v1",
      mode,
      transcript: best.Display || payload.DisplayText || "",
      transcriptConfidence: best.Confidence,
      transcriptSource: "pronunciation-assessment",
      durationMs: input.durationMs,
      accuracy: scores.AccuracyScore,
      fluency: scores.FluencyScore,
      prosody: scores.ProsodyScore,
      completeness: scores.CompletenessScore,
      words
    });
  };
}

function normalizeAzureWord_(word) {
  const assessment = word?.PronunciationAssessment ?? word ?? {};
  return {
    word: word?.Word ?? "",
    accuracy: assessment.AccuracyScore,
    errorType: assessment.ErrorType ?? "None"
  };
}

function normalizeRecognitionUrl_(value) {
  try {
    const url = new URL(String(value || ""));
    const azureHost = /(?:^|\.)cognitiveservices\.azure\.com$/i.test(url.hostname)
      || /(?:^|\.)stt\.speech\.microsoft\.com$/i.test(url.hostname);
    if (url.protocol !== "https:"
      || !azureHost
      || !/\/speech\/recognition\/conversation\/cognitiveservices\/v1\/?$/.test(url.pathname)) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function providerResponseError_(status, recognitionStatus) {
  if (["NoMatch", "InitialSilenceTimeout", "BabbleTimeout"].includes(recognitionStatus)) {
    return new AssessmentProviderError(
      "SPEECH_NOT_RECOGNIZED",
      "Speech was not recognized.",
      422
    );
  }
  if (status === 401 || status === 403) {
    return new AssessmentProviderError(
      "PROVIDER_AUTH_FAILED",
      "Assessment service unavailable.",
      503
    );
  }
  if (status === 400) {
    return new AssessmentProviderError(
      "PROVIDER_BAD_REQUEST",
      "Assessment service unavailable.",
      503
    );
  }
  if (status === 429) {
    return new AssessmentProviderError(
      "PROVIDER_RATE_LIMITED",
      "Assessment service unavailable.",
      503
    );
  }
  return new AssessmentProviderError(
    "PROVIDER_UNAVAILABLE",
    "Assessment service unavailable.",
    503
  );
}
