// Pure WAV helpers shared by the browser (encoding) and the server (validation).
// No browser or Node APIs are used, so this runs in both.

/**
 * A recording whose loudest sample is below this (as a fraction of full scale)
 * is treated as silence. Whisper tends to invent words for silence, so quiet
 * clips are rejected before they reach it. The browser and the server use the
 * same value on purpose.
 */
export const SILENCE_PEAK = 0.02;

export type WavInfo = {
  channels: number;
  sampleRate: number;
  bits: number;
  dataOffset: number;
  dataLength: number;
};

function tag(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** Parses a 16-bit PCM WAV header. Returns null for anything else. */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  if (tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: { channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const id = tag(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt ") {
      if (body + 16 > bytes.length) return null;
      const audioFormat = view.getUint16(body, true);
      if (audioFormat !== 1) return null; // PCM only
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!format) return null;
      if (format.bits !== 16) return null;
      if (format.channels < 1 || format.channels > 2) return null;
      if (format.sampleRate < 8000 || format.sampleRate > 48000) return null;
      // Streamed WAVs can declare a bogus length, so clamp to what is really there.
      const available = bytes.length - body;
      const dataLength = Math.min(size, available);
      if (dataLength < 2) return null;
      return { ...format, dataOffset: body, dataLength };
    }

    // Chunks are word-aligned.
    offset = body + size + (size % 2);
  }
  return null;
}

/** Loudest sample as a fraction of full scale, from 0 to 1. */
export function wavPeak(bytes: Uint8Array, info: WavInfo): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = info.dataOffset + info.dataLength - 1;
  let peak = 0;
  for (let i = info.dataOffset; i < end; i += 2) {
    const value = Math.abs(view.getInt16(i, true));
    if (value > peak) peak = value;
  }
  return Math.min(1, peak / 32768);
}

/** Encodes mono float samples (-1 to 1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataLength = samples.length * 2;
  const bytes = new Uint8Array(new ArrayBuffer(44 + dataLength));
  const view = new DataView(bytes.buffer);

  const writeTag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, dataLength, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
  }
  return bytes;
}

/** Averages source samples that fall into each output sample (a box filter). */
export function resampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;

  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / (end - start);
  }
  return output;
}
