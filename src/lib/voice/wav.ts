/**
 * Normalise recorded audio to 16 kHz mono WAV before upload.
 *
 * Why this exists: `microsoft/mai-transcribe-2` rejects the containers browsers
 * actually record. MediaRecorder gives webm/opus on Chrome/Firefox/Android and
 * mp4/aac on iOS Safari, and the provider returns 400 for both regardless of
 * the declared `format` — verified by sending one identical webm file to
 * several models, where whisper-1, gpt-4o-mini-transcribe and chirp-3 all
 * accepted it and mai-transcribe-2 alone refused.
 *
 * `decodeAudioData` understands every container the browser can record, so
 * decoding to PCM and re-encoding as WAV collapses all platform differences
 * into the one format the provider is known to accept. 16 kHz mono is the
 * standard speech-recognition rate and keeps the upload small.
 */

const TARGET_RATE = 16000;

/** Interleave-free mono WAV (RIFF/PCM 16-bit) from float samples. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // Asymmetric scaling: int16 range is -32768..32767.
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Average all channels down to one. */
function downmix(audio: AudioBuffer): Float32Array {
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const channel = audio.getChannelData(c);
    for (let i = 0; i < audio.length; i++) mono[i] += channel[i] / audio.numberOfChannels;
  }
  return mono;
}

/**
 * Decode whatever MediaRecorder produced and re-encode as 16 kHz mono WAV.
 * Throws if the browser can't decode the blob — callers should fall back to
 * uploading the original rather than losing the recording.
 */
export async function toWav(blob: Blob): Promise<Blob> {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());

    try {
      // Proper resampling, rather than naive sample dropping.
      const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
      const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      return encodeWav(rendered.getChannelData(0), TARGET_RATE);
    } catch {
      // Older Safari refuses OfflineAudioContext rates below 44.1 kHz. Keeping
      // the original rate costs upload size but still produces valid WAV.
      return encodeWav(downmix(decoded), decoded.sampleRate);
    }
  } finally {
    ctx.close().catch(() => {});
  }
}
