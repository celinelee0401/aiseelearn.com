export class TranscriptionProviderError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createAzureFastTranscriber(options = {}) {
  const {
    endpoint,
    key,
    fetchImpl = fetch,
    timeoutMs = 15_000
  } = options;
  const transcriptionUrl = normalizeTranscriptionUrl_(endpoint);
  if (!transcriptionUrl || typeof key !== "string" || key.length < 16) {
    throw new TypeError("Azure fast transcription configuration is invalid");
  }

  return async function transcribe(input) {
    if (!(input?.audio instanceof ArrayBuffer)) throw new TypeError("audio must be an ArrayBuffer");
    const phrases = normalizePhrases_(input.phrases);
    const definition = {
      locales: ["en-US"],
      profanityFilterMode: "None",
      ...(phrases.length ? { phraseList: { phrases } } : {})
    };
    const form = new FormData();
    form.set("audio", new File([input.audio], "fluency-round.wav", { type: "audio/wav" }));
    form.set("definition", JSON.stringify(definition));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(transcriptionUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Ocp-Apim-Subscription-Key": key
        },
        body: form,
        signal: controller.signal
      });
    } catch (error) {
      const code = error?.name === "AbortError" ? "TRANSCRIPTION_TIMEOUT" : "TRANSCRIPTION_UNAVAILABLE";
      throw new TranscriptionProviderError(code, "Enhanced transcription unavailable.");
    } finally {
      clearTimeout(timeoutId);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new TranscriptionProviderError("TRANSCRIPTION_INVALID_RESPONSE", "Enhanced transcription unavailable.");
    }
    if (!response.ok) throw transcriptionResponseError_(response.status);

    const transcript = combinedTranscript_(payload);
    const phraseRows = Array.isArray(payload?.phrases) ? payload.phrases : [];
    const wordCount = countWords_(phraseRows, transcript);
    const confidence = weightedConfidence_(phraseRows);
    if (!transcript || wordCount < 1) {
      throw new TranscriptionProviderError("TRANSCRIPTION_NO_MATCH", "Enhanced transcription unavailable.", 422);
    }
    return Object.freeze({
      provider: "azure-fast-transcription",
      version: "2025-10-15",
      transcript,
      wordCount,
      confidence
    });
  };
}

function normalizeTranscriptionUrl_(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !/(?:^|\.)cognitiveservices\.azure\.com$/i.test(url.hostname)) {
      return null;
    }
    url.pathname = "/speechtotext/transcriptions:transcribe";
    url.search = "?api-version=2025-10-15";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizePhrases_(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((phrase) => typeof phrase === "string")
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase && phrase.length <= 100))]
    .slice(0, 100);
}

function combinedTranscript_(payload) {
  const combined = Array.isArray(payload?.combinedPhrases)
    ? payload.combinedPhrases.map((row) => row?.text).filter((text) => typeof text === "string" && text.trim())
    : [];
  if (combined.length) return combined.join(" ").trim();
  return (Array.isArray(payload?.phrases) ? payload.phrases : [])
    .map((row) => row?.text)
    .filter((text) => typeof text === "string" && text.trim())
    .join(" ")
    .trim();
}

function countWords_(phrases, transcript) {
  const providerWords = phrases.reduce((count, phrase) => (
    count + (Array.isArray(phrase?.words) ? phrase.words.filter((word) => String(word?.text || "").trim()).length : 0)
  ), 0);
  if (providerWords) return providerWords;
  return transcript.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
}

function weightedConfidence_(phrases) {
  let totalWeight = 0;
  let weightedTotal = 0;
  for (const phrase of phrases) {
    const confidence = Number(phrase?.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
    const wordWeight = Array.isArray(phrase?.words)
      ? phrase.words.filter((word) => String(word?.text || "").trim()).length
      : 0;
    const durationWeight = Number(phrase?.durationMilliseconds ?? phrase?.duration);
    const weight = wordWeight || (Number.isFinite(durationWeight) && durationWeight > 0 ? durationWeight : 1);
    weightedTotal += confidence * weight;
    totalWeight += weight;
  }
  return totalWeight ? Math.round(weightedTotal / totalWeight * 1_000) / 1_000 : null;
}

function transcriptionResponseError_(status) {
  if (status === 401 || status === 403) {
    return new TranscriptionProviderError("TRANSCRIPTION_AUTH_FAILED", "Enhanced transcription unavailable.");
  }
  if (status === 429) {
    return new TranscriptionProviderError("TRANSCRIPTION_RATE_LIMITED", "Enhanced transcription unavailable.");
  }
  if (status === 400 || status === 413 || status === 415) {
    return new TranscriptionProviderError("TRANSCRIPTION_BAD_REQUEST", "Enhanced transcription unavailable.");
  }
  return new TranscriptionProviderError("TRANSCRIPTION_UNAVAILABLE", "Enhanced transcription unavailable.");
}
