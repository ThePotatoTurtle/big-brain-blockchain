"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { USERS } from "@/lib/users";
import {
  resolveSpeaker,
  needsPayerChoice,
  withPayer,
  type VoiceParsedEntry,
  type VoiceEntryResponse,
} from "@/lib/voice/schema";
import { toWav } from "@/lib/voice/wav";

/**
 * Mic capture for dictated entries.
 *
 * Tap to start, tap again to stop — the recording is only uploaded on the
 * second tap, never streamed. While recording we show a live input-level meter
 * and a timer rather than a live transcript: the chosen STT model
 * (mai-transcribe-2) is batch-only, and wiring a second engine just for an
 * interim preview would ship the audio to another provider the user didn't pick.
 * The real transcript animates in as soon as it lands.
 *
 * Audio never leaves this component except as one POST body; nothing is stored.
 */

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus", // Chrome, Edge, Firefox, Android
  "audio/webm",
  "audio/mp4", // iOS Safari — AAC in an MP4 container
  "audio/ogg;codecs=opus",
  "audio/aac",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported?.(t)) return t;
    } catch {
      /* isTypeSupported throws on some older Safari builds */
    }
  }
  return undefined; // let the browser pick; blob.type tells us what we got
}

const MAX_SECONDS = 60;

/**
 * Meter calibration, in dBFS.
 *
 * Speech is nowhere near full scale — conversational level into a phone mic sits
 * around -35..-18 dBFS, so a linear peak meter barely leaves the left edge.
 * Mapping this dB window onto the bar makes normal speech use its whole range,
 * and because the scale is logarithmic it stays responsive when quiet.
 */
const METER_MIN_DB = -55; // below this reads as silence
const METER_MAX_DB = -15; // at/above this the bar is full
/** Per-frame decay, so the bar falls back smoothly instead of strobing. */
const METER_DECAY = 0.82;

type Phase =
  | "idle"
  | "recording"
  | "transcribing"
  | "parsing"
  | "identify"
  | "error";

export default function VoiceEntryButton({
  onParsed,
  disabled,
}: {
  /** Called with a fully resolved entry — no SPEAKER placeholders remain. */
  onParsed: (parsed: VoiceParsedEntry, transcript: string) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  // Text and how much of it has been revealed live together, so a new
  // transcript can never briefly render against the previous one's progress.
  const [reveal, setReveal] = useState<{ text: string; chars: number }>({
    text: "",
    chars: 0,
  });
  const transcript = reveal.text;
  const shownChars = reveal.chars;
  const showTranscript = useCallback(
    (text: string) => setReveal({ text, chars: 0 }),
    []
  );

  /**
   * The entry awaiting a person choice, plus which question is being asked.
   * "speaker" resolves the "I" placeholder; "payer" fills a payer nobody named.
   * Both can be needed from one utterance, so they're asked in turn.
   */
  const [pending, setPending] = useState<
    { entry: VoiceParsedEntry; ask: "speaker" | "payer" } | null
  >(null);
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const meterStreamRef = useRef<MediaStream | null>(null);
  /**
   * The MediaStreamAudioSourceNode must be retained. Only the analyser is
   * reachable from the meter closure, so an un-referenced source node gets
   * garbage-collected mid-recording, silently disconnecting the graph and
   * pinning the meter at zero.
   */
  const meterSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Release mic, meter and timers. Safe to call repeatedly. */
  const teardown = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    meterSourceRef.current?.disconnect();
    meterSourceRef.current = null;
    meterStreamRef.current?.getTracks().forEach((t) => t.stop());
    meterStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    recorderRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  // Reveal the transcript progressively once it arrives. The character count is
  // derived from elapsed time inside the interval callback, so nothing calls
  // setState synchronously in the effect body.
  useEffect(() => {
    const text = reveal.text;
    if (!text) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      const chars = Math.floor((Date.now() - startedAt) / 8);
      setReveal((r) =>
        r.text === text ? { text, chars: Math.min(chars, text.length) } : r
      );
      if (chars >= text.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [reveal.text]);

  const send = useCallback(
    async (recorded: Blob) => {
      setPhase("transcribing");
      try {
        // Normalise to WAV: the STT provider rejects the webm/opus and mp4/aac
        // that MediaRecorder actually produces. If decoding fails, send the
        // original rather than dropping the recording entirely.
        let blob = recorded;
        let ext = recorded.type.includes("mp4") ? "m4a" : "webm";
        try {
          blob = await toWav(recorded);
          ext = "wav";
        } catch {
          console.warn("Could not transcode recording; uploading original");
        }

        const body = new FormData();
        body.append("audio", blob, `entry.${ext}`);

        const res = await fetch("/api/voice-entry", { method: "POST", body });
        const data = await res.json();

        if (!res.ok) {
          if (data.transcript) showTranscript(data.transcript);
          setError(data.error ?? "Something went wrong");
          setPhase("error");
          return;
        }

        const payload = data as VoiceEntryResponse;
        showTranscript(payload.transcript);

        // Ask before touching the form: "I"/"we" first, then a missing payer.
        if (payload.needsSpeakerIdentity) {
          setPending({ entry: payload.parsed, ask: "speaker" });
          setPhase("identify");
          return;
        }
        if (payload.needsPayer) {
          setPending({ entry: payload.parsed, ask: "payer" });
          setPhase("identify");
          return;
        }
        setPhase("idle");
        onParsed(payload.parsed, payload.transcript);
      } catch {
        setError("Network error — check your connection");
        setPhase("error");
      }
    },
    [onParsed, showTranscript]
  );

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    setError("");
    showTranscript("");
    setPending(null);
    setSeconds(0);
    // Checked on click rather than at mount: it can't be evaluated during SSR,
    // and telling the user why is better than a button that silently vanishes.
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("This browser can't record audio.");
      setPhase("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Input-level meter. It runs on a CLONED track, not the one being
      // recorded: on iOS Safari, attaching a MediaStreamSource to the same
      // track MediaRecorder is writing can corrupt the resulting MP4.
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      // Safari (and Chrome under autoplay policy) hands back a SUSPENDED
      // context. A suspended analyser reports pure silence, so the meter would
      // sit at zero for the whole recording.
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const meterTrack = stream.getAudioTracks()[0]?.clone();
      if (meterTrack) {
        meterStreamRef.current = new MediaStream([meterTrack]);
        meterSourceRef.current = ctx.createMediaStreamSource(meterStreamRef.current);
        meterSourceRef.current.connect(analyser);
      }
      // Float samples, not getByteTimeDomainData: 8-bit data quantises to
      // 1/128, which is an RMS noise floor around -53 dBFS — inside the meter's
      // range, so a silent room would read about a quarter full.
      const buf = new Float32Array(analyser.fftSize);
      let smoothed = 0;
      const meter = () => {
        analyser.getFloatTimeDomainData(buf);
        // RMS rather than peak: peak is dominated by single samples and jitters.
        let sum = 0;
        for (const x of buf) sum += x * x;
        const rms = Math.sqrt(sum / buf.length);
        const db = 20 * Math.log10(rms + 1e-8);
        const norm = (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB);
        // Rise immediately, fall gradually.
        smoothed = Math.max(Math.min(1, Math.max(0, norm)), smoothed * METER_DECAY);
        setLevel(smoothed);
        rafRef.current = requestAnimationFrame(meter);
      };
      meter();

      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || mimeType || "audio/webm",
        });
        teardown();
        if (blob.size < 1200) {
          setError("That was too short — hold on a moment longer.");
          setPhase("error");
          return;
        }
        void send(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setPhase("recording");

      tickRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      teardown();
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Microphone blocked — allow mic access and try again."
          : "Couldn't start recording."
      );
      setPhase("error");
    }
  }, [send, stop, teardown, showTranscript]);

  const choosePerson = (userId: number) => {
    if (!pending) return;
    const resolved =
      pending.ask === "speaker"
        ? resolveSpeaker(pending.entry, userId)
        : withPayer(pending.entry, userId);

    // Resolving "I" can itself supply the payer; only ask again if it didn't.
    if (pending.ask === "speaker" && needsPayerChoice(resolved)) {
      setPending({ entry: resolved, ask: "payer" });
      return;
    }
    setPending(null);
    setPhase("idle");
    onParsed(resolved, transcript);
  };

  const busy = phase === "transcribing" || phase === "parsing";
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");

  return (
    <>
      <button
        type="button"
        onClick={phase === "recording" ? stop : start}
        disabled={disabled || busy}
        aria-label={phase === "recording" ? "Stop recording" : "Dictate an entry"}
        aria-pressed={phase === "recording"}
        className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset transition-colors disabled:opacity-40 ${
          phase === "recording"
            ? "bg-red-500/25 text-red-300 ring-red-400/50"
            : "bg-accent/20 text-accent ring-accent/40 hover:bg-accent/30"
        }`}
      >
        <MicIcon recording={phase === "recording"} />
        {phase === "recording"
          ? `Stop ${mins}:${secs}`
          : busy
            ? "Listening…"
            : "Speak"}
      </button>

      {(phase === "recording" || busy || transcript || error) && (
        <div className="w-full mt-2 mb-3 rounded-lg bg-background border border-border p-3">
          {phase === "recording" && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-[var(--card-hover)] overflow-hidden">
                <div
                  className="h-full bg-red-400 rounded-full transition-[width] duration-75"
                  style={{ width: `${Math.max(3, level * 100)}%` }}
                />
              </div>
              <span className="text-[11px] text-muted tabular-nums">
                {mins}:{secs}
              </span>
            </div>
          )}

          {busy && (
            <p className="text-xs text-muted animate-pulse">
              {phase === "transcribing" ? "Transcribing…" : "Understanding…"}
            </p>
          )}

          {transcript && (
            <p className="text-xs text-foreground leading-relaxed">
              {transcript.slice(0, shownChars)}
              {shownChars < transcript.length && (
                <span className="opacity-40">▊</span>
              )}
            </p>
          )}

          {error && <p className="text-xs text-red-400 mt-1">{error}</p>}

          {phase === "identify" && (
            <div className="mt-3">
              <p className="text-[11px] text-muted mb-2">
                {pending?.ask === "payer"
                  ? "Who paid?"
                  : "You said “I” — who’s speaking?"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {USERS.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => choosePerson(u.id)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-80"
                    style={{ backgroundColor: u.color + "20", color: u.color }}
                  >
                    {u.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MicIcon({ recording }: { recording: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={recording ? "animate-pulse" : ""}
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
