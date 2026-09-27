const PCM_WAV_HEADER_BYTES = 44;

export function inspectPcm16Wav(value) {
  const buffer = asArrayBuffer_(value);
  if (!buffer || buffer.byteLength < PCM_WAV_HEADER_BYTES) return invalid_();

  const view = new DataView(buffer);
  if (ascii_(view, 0, 4) !== "RIFF" || ascii_(view, 8, 4) !== "WAVE") return invalid_();

  const format = findChunk_(view, "fmt ");
  const data = findChunk_(view, "data");
  if (!format || format.length < 16 || !data || data.length < 2) return invalid_();

  const audioFormat = view.getUint16(format.offset, true);
  const channels = view.getUint16(format.offset + 2, true);
  const sampleRate = view.getUint32(format.offset + 4, true);
  const bitsPerSample = view.getUint16(format.offset + 14, true);
  if (audioFormat !== 1 || channels !== 1 || sampleRate !== 16_000 || bitsPerSample !== 16) {
    return invalid_();
  }

  const sampleCount = Math.floor(data.length / 2);
  let sumSquares = 0;
  let peak = 0;
  let clippedSamples = 0;
  for (let offset = data.offset; offset + 1 < data.offset + data.length; offset += 2) {
    const amplitude = Math.abs(view.getInt16(offset, true) / 32768);
    sumSquares += amplitude * amplitude;
    peak = Math.max(peak, amplitude);
    if (amplitude >= 0.985) clippedSamples += 1;
  }

  const durationMs = Math.round(sampleCount / sampleRate * 1000);
  const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
  const clippingRatio = clippedSamples / Math.max(1, sampleCount);
  const status = durationMs < 1_400
    ? "too-short"
    : rms < 0.012
      ? "too-quiet"
      : clippingRatio > 0.025
        ? "clipping"
        : "pass";

  return Object.freeze({
    status,
    durationMs,
    rms: round_(rms, 5),
    peak: round_(peak, 5),
    clippingRatio: round_(clippingRatio, 6),
    sampleRate,
    channels,
    bitsPerSample
  });
}

function asArrayBuffer_(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

function findChunk_(view, expectedId) {
  let cursor = 12;
  while (cursor + 8 <= view.byteLength) {
    const id = ascii_(view, cursor, 4);
    const declaredLength = view.getUint32(cursor + 4, true);
    const offset = cursor + 8;
    const length = Math.min(declaredLength, Math.max(0, view.byteLength - offset));
    if (id === expectedId) return { offset, length };
    cursor = offset + declaredLength + (declaredLength % 2);
  }
  return null;
}

function ascii_(view, offset, length) {
  if (offset < 0 || offset + length > view.byteLength) return "";
  return Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join("");
}

function round_(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function invalid_() {
  return Object.freeze({
    status: "invalid-format",
    durationMs: 0,
    rms: 0,
    peak: 0,
    clippingRatio: 0,
    sampleRate: null,
    channels: null,
    bitsPerSample: null
  });
}
