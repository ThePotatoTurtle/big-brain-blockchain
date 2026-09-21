import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { todayString } from "@/lib/utils";
import { buildVoiceSystemPrompt, VOICE_ENTRY_JSON_SCHEMA } from "@/lib/voice/prompt";
import {
  hasSpeakerRef,
  needsPayerChoice,
  type VoiceParsedEntry,
  type VoiceEntryResponse,
} from "@/lib/voice/schema";

/**
 * POST /api/voice-entry
 *
 * Audio in → structured ledger entry out, in two hops:
 *   1. OpenRouter (microsoft/mai-transcribe-2) transcribes. Transcription only —
 *      no interpretation happens in this pass.
 *   2. Claude parses the transcript into fields.
 *
 * The audio is held in memory for the length of the request and never written
 * anywhere — not to Blob storage, not to logs. Only submitted entries persist.
 *
 * Both hops run server-side so neither API key is exposed to the browser.
 */

export const maxDuration = 60;

/** OpenRouter accepts these container formats. */
const FORMAT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

/** Strip codec parameters: "audio/webm;codecs=opus" → "audio/webm". */
function audioFormat(mime: string): string | null {
  const base = mime.split(";")[0].trim().toLowerCase();
  return FORMAT_BY_MIME[base] ?? null;
}

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const STT_MODEL = "microsoft/mai-transcribe-2";
/**
 * Container fallback. mai-transcribe-2 is the most accurate on the non-streaming
 * board but it only accepts a narrow set of containers — it 400s on the
 * webm/opus and mp4/aac that MediaRecorder produces, which is why the client
 * transcodes to WAV first. If that transcode ever fails (an unusual browser, a
 * decode error), whisper-1 accepts the raw container, so a slightly less
 * accurate transcript beats no transcript at all.
 */
const STT_FALLBACK_MODEL = "openai/whisper-1";

type SttResult =
  | { ok: true; text: string; via: string }
  | { ok: false; status: number; detail: string; via: string };

/**
 * Transcribe via multipart first, falling back to the JSON/base64 shape.
 *
 * Multipart is preferred: the provider receives the filename and content type
 * (useful for container sniffing, which matters for the MP4/AAC that iOS Safari
 * records) and there's no 33% base64 inflation on the upload.
 */
async function transcribe(
  bytes: Buffer,
  mime: string,
  format: string,
  filename: string,
  key: string
): Promise<SttResult> {
  const auth = { Authorization: `Bearer ${key}` };

  const attempt = async (model: string) => {
    const fd = new FormData();
    fd.append("model", model);
    fd.append("language", "en");
    fd.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    return fetch(STT_URL, { method: "POST", headers: auth, body: fd });
  };

  let res = await attempt(STT_MODEL);
  if (res.ok) {
    const j = (await res.json()) as { text?: string };
    return { ok: true, text: (j.text ?? "").trim(), via: STT_MODEL };
  }
  const firstStatus = res.status;
  const firstDetail = (await res.text()).slice(0, 400);

  res = await attempt(STT_FALLBACK_MODEL);
  if (res.ok) {
    const j = (await res.json()) as { text?: string };
    return { ok: true, text: (j.text ?? "").trim(), via: `${STT_FALLBACK_MODEL} (primary ${firstStatus})` };
  }

  return {
    ok: false,
    status: res.status,
    // Both upstream messages — these are error strings, not audio content.
    detail: `${STT_MODEL} ${firstStatus}: ${firstDetail} || ${STT_FALLBACK_MODEL} ${res.status}: ${(await res.text()).slice(0, 400)}`,
    via: "both",
  };
}

export async function POST(request: NextRequest) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 500 }
    );
  }
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("audio") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Recording too long — keep it under a minute." },
      { status: 400 }
    );
  }

  const format = audioFormat(file.type || "");
  if (!format) {
    return NextResponse.json(
      { error: `Unsupported audio format: ${file.type || "unknown"}` },
      { status: 400 }
    );
  }

  // ---------- 1. Transcribe ----------
  let transcript: string;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await transcribe(
      bytes,
      file.type || "application/octet-stream",
      format,
      file.name || `audio.${format}`,
      OPENROUTER_API_KEY
    );

    if (!result.ok) {
      // Log the upstream message, the declared type and the size. Without this
      // an iOS-only failure is undiagnosable from the Vercel logs; none of it
      // is audio content.
      console.error(
        `OpenRouter transcription failed (${result.status}) ` +
          `mime=${file.type || "?"} format=${format} bytes=${bytes.length}: ${result.detail}`
      );
      return NextResponse.json(
        { error: "Could not transcribe the recording" },
        { status: 502 }
      );
    }
    if (result.via !== STT_MODEL) {
      console.warn(`Transcription fell back to ${result.via}`);
    }
    transcript = result.text;
  } catch (err) {
    console.error("Transcription error:", err);
    return NextResponse.json(
      { error: "Could not transcribe the recording" },
      { status: 502 }
    );
  }

  if (!transcript) {
    return NextResponse.json(
      { error: "Didn't catch any speech — try again." },
      { status: 422 }
    );
  }

  // ---------- 2. Parse ----------
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const today = todayString();

    const message = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      // The system prompt is long and byte-identical across calls except for
      // the date, so it caches cleanly and costs ~nothing after the first call.
      system: [
        {
          type: "text",
          text: buildVoiceSystemPrompt(today),
          cache_control: { type: "ephemeral" },
        },
      ],
      // Adaptive thinking at low effort: this is bounded extraction and the
      // user is waiting on it.
      thinking: { type: "adaptive" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: VOICE_ENTRY_JSON_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Parse this dictated entry:\n\n"""${transcript}"""`,
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "Could not process that recording" },
        { status: 422 }
      );
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "Could not understand the recording", transcript },
        { status: 422 }
      );
    }

    // Structured outputs guarantee schema-valid JSON, so no regex extraction.
    const parsed = JSON.parse(textBlock.text) as VoiceParsedEntry;

    const response: VoiceEntryResponse = {
      transcript,
      parsed,
      needsSpeakerIdentity: hasSpeakerRef(parsed),
      needsPayer: needsPayerChoice(parsed),
    };
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error("Voice parse API error:", err.status, err.message);
    } else {
      console.error("Voice parse error:", err);
    }
    return NextResponse.json(
      { error: "Could not understand the recording", transcript },
      { status: 502 }
    );
  }
}
