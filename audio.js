// Audio files of a score's playback, for sharing: AAC in an .m4a (plays on any
// phone, ~0.7 MB a minute) where the browser can encode AAC (WebCodecs;
// Chrome on Android, macOS and Windows), otherwise WAV. The m4a container is
// written by mp4-muxer (MIT), loaded on first use.

const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs";
export const AUDIO_RATE = 44100;
const BITRATE = 96000;
const FRAMES = 4096; // samples handed to the encoder at a time

// The rendering scaled so its loudest moment is just below full scale.
function normalised(buffer) {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 0 ? 0.9 / peak : 1;
  return data.map((v) => v * scale);
}

async function aacSupported(sampleRate) {
  if (!("AudioEncoder" in self)) return false;
  const { supported } = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate, numberOfChannels: 1, bitrate: BITRATE }).catch(() => ({}));
  return !!supported;
}

async function m4a(samples, sampleRate) {
  const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, audio: { codec: "aac", numberOfChannels: 1, sampleRate }, fastStart: "in-memory" });
  let failed = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failed = e) });
  encoder.configure({ codec: "mp4a.40.2", sampleRate, numberOfChannels: 1, bitrate: BITRATE });
  for (let i = 0; i < samples.length; i += FRAMES) {
    const data = samples.subarray(i, i + FRAMES);
    const frame = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: data.length, numberOfChannels: 1, timestamp: Math.round((i / sampleRate) * 1e6), data });
    encoder.encode(frame);
    frame.close();
  }
  await encoder.flush();
  encoder.close();
  if (failed) throw failed;
  muxer.finalize();
  return new Blob([target.buffer], { type: "audio/x-m4a" });
}

function wav(samples, sampleRate) {
  const n = samples.length;
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([view.buffer], { type: "audio/wav" });
}

// A File named `${name}.m4a` (or .wav) from a rendered AudioBuffer.
export async function audioFile(buffer, name) {
  const samples = normalised(buffer);
  if (await aacSupported(buffer.sampleRate)) {
    try {
      // audio/x-m4a: the type Chrome's share sheet accepts for .m4a (not audio/mp4).
      return new File([await m4a(samples, buffer.sampleRate)], `${name}.m4a`, { type: "audio/x-m4a" });
    } catch {}
  }
  return new File([wav(samples, buffer.sampleRate)], `${name}.wav`, { type: "audio/wav" });
}
