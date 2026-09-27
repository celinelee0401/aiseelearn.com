const TARGET_SAMPLE_RATE = 16_000;

export class PcmWavRecorder {
  constructor(options = {}) {
    this.navigator = options.navigator ?? globalThis.navigator;
    this.AudioContext = options.AudioContext
      ?? globalThis.AudioContext
      ?? globalThis.webkitAudioContext;
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.silence = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  async start() {
    if (this.stream) throw new Error("Recorder is already running");
    if (!this.navigator?.mediaDevices?.getUserMedia || !this.AudioContext) {
      throw new Error("Audio recording is not supported");
    }
    this.stream = await this.navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    this.context = new this.AudioContext();
    await this.context.resume();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.silence = this.context.createGain();
    this.silence.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.silence);
    this.silence.connect(this.context.destination);
    this.startedAt = performance.now();
  }

  async stop() {
    if (!this.stream || !this.context) throw new Error("Recorder is not running");
    const durationMs = Math.max(1, Math.round(performance.now() - this.startedAt));
    this.processor.onaudioprocess = null;
    this.source.disconnect();
    this.processor.disconnect();
    this.silence.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
    const inputSampleRate = this.context.sampleRate;
    await this.context.close();
    const samples = mergeFloat32_(this.chunks);
    const resampled = resampleMono(samples, inputSampleRate, TARGET_SAMPLE_RATE);
    const wav = encodePcm16Wav(resampled, TARGET_SAMPLE_RATE);
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.silence = null;
    this.chunks = [];
    return Object.freeze({
      blob: new Blob([wav], { type: "audio/wav" }),
      durationMs,
      sampleRate: TARGET_SAMPLE_RATE
    });
  }

  cancel() {
    if (this.processor) this.processor.onaudioprocess = null;
    for (const track of this.stream?.getTracks?.() ?? []) track.stop();
    this.source?.disconnect?.();
    this.processor?.disconnect?.();
    this.silence?.disconnect?.();
    void this.context?.close?.();
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.silence = null;
    this.chunks = [];
  }
}

export function resampleMono(samples, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
  if (!(samples instanceof Float32Array)) throw new TypeError("samples must be Float32Array");
  if (!Number.isFinite(sourceRate) || !Number.isFinite(targetRate) || sourceRate <= 0 || targetRate <= 0) {
    throw new TypeError("sample rate is invalid");
  }
  if (samples.length === 0) return new Float32Array(0);
  if (sourceRate === targetRate) return new Float32Array(samples);
  const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.min(samples.length - 1, Math.floor(position));
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const weight = position - leftIndex;
    output[index] = samples[leftIndex] * (1 - weight) + samples[rightIndex] * weight;
  }
  return output;
}

export function encodePcm16Wav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  if (!(samples instanceof Float32Array) || !Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new TypeError("PCM input is invalid");
  }
  const dataLength = samples.length * 2;
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
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return buffer;
}

function mergeFloat32_(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function ascii_(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
