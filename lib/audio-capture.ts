import { SILENCE_PEAK, encodeWav, resampleMono } from "./wav";

// Whisper expects 16 kHz mono audio.
const TARGET_RATE = 16_000;

type AudioContextConstructor = typeof AudioContext;

function createContext(): AudioContext {
  const Ctor: AudioContextConstructor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not supported");
  return new Ctor();
}

/**
 * Converts whatever the browser recorded (WebM/Opus in Chrome and Firefox,
 * MP4/AAC in Safari) into a 16 kHz mono WAV. Doing this in the browser means the
 * server never has to run a media decoder on untrusted uploads.
 *
 * `silent` is true when the recording is too quiet to contain speech.
 */
export async function recordingToWav(
  blob: Blob,
): Promise<{ wav: Blob; silent: boolean; seconds: number }> {
  const context = createContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());

    // Mix every channel down to mono.
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / decoded.numberOfChannels;
    }

    const samples = resampleMono(mono, decoded.sampleRate, TARGET_RATE);

    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.abs(samples[i]);
      if (value > peak) peak = value;
    }

    return {
      wav: new Blob([encodeWav(samples, TARGET_RATE)], { type: "audio/wav" }),
      silent: peak < SILENCE_PEAK,
      seconds: samples.length / TARGET_RATE,
    };
  } finally {
    void context.close();
  }
}
