import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { todayString } from "@/lib/utils";
import { buildVoiceSystemPrompt, VOICE_ENTRY_JSON_SCHEMA } from "@/lib/voice/prompt";
import {
  hasSpeakerRef,
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
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const sttRes = await fetch(
      "https://openrouter.ai/api/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: "microsoft/mai-transcribe-2",
          input_audio: { data: base64, format },
          language: "en",
        }),
      }
    );

    if (!sttRes.ok) {
      // Log status only — the body can echo back audio metadata.
      console.error("OpenRouter transcription failed:", sttRes.status);
      return NextResponse.json(
        { error: "Could not transcribe the recording" },
        { status: 502 }
      );
    }

    const sttData = (await sttRes.json()) as { text?: string };
    transcript = (sttData.text ?? "").trim();
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
      model: "claude-opus-5",
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
      // Thinking stays on (Opus 5 misbehaves with it disabled) but at low
      // effort — this is bounded extraction, and the user is waiting.
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
