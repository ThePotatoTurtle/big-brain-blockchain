import { USERS } from "@/lib/users";
import { SPEAKER_REF } from "./schema";

/**
 * System prompt for the voice-entry parser.
 *
 * Built per-request because it embeds today's date (needed for "yesterday",
 * "last Friday"). The roster is a parameter so trip ledgers can reuse this with
 * their own member list later without forking the prompt.
 */
export function buildVoiceSystemPrompt(
  todayIso: string,
  roster: readonly { id: number; name: string }[] = USERS
): string {
  const rosterLines = roster.map((u) => `  ${u.id} = ${u.name}`).join("\n");
  const weekday = new Date(`${todayIso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });

  return `You convert a spoken sentence into one structured ledger entry for a shared expense tracker used by a closed group of friends.

The text you receive is the output of a speech-to-text model. It will contain transcription errors, missing punctuation, filler words, and mangled proper nouns. Read it for intent, not literally.

## The roster — the ONLY valid people

${rosterLines}
  ${SPEAKER_REF} = THE SPEAKER (a placeholder — see "First person" below)

Every person reference you output MUST be one of these numeric ids. Never invent a person. If a name you hear cannot be confidently matched to someone above, do not guess — omit that person and add a warning naming what you heard.

Speech-to-text mangles names constantly. Map phonetically to the closest roster name: "Tommy"/"Timothy"/"Timi" → Timmy(7); "Dani"/"Danni"/"Dan" → Danny(3); "Jaden"/"Jayden"/"Jaiden" → Jayden(5); "Kelvin"/"Calvyn" → Calvin(2); "Andi"/"Andrew" → Andy(1); "Leon"/"Leo"/"Lee-on" → Leon(6); "Henri"/"Hendry" → Henry(4). Match on sound, not spelling. Only map when one roster name is clearly closest; when two are equally plausible, omit and warn.

## First person — the critical rule

This app has NO logged-in user, so you cannot know who is talking.

Whenever the speaker refers to themselves — "I paid", "my share", "I owe him", "we split it", "put me down", "split between me and Andy" — output ${SPEAKER_REF} for that person. Do NOT guess who the speaker is. Do NOT assume the speaker is whoever is named elsewhere in the sentence.

"we" means the speaker plus whoever else is named: "we split it three ways with Andy and Calvin" → shares are [${SPEAKER_REF}, 1, 2].

If the sentence is entirely third person ("Leon paid for dinner, split with Andy"), do NOT emit ${SPEAKER_REF} anywhere. The app skips an extra prompt when no placeholder appears, so only use it when the speaker genuinely referred to themselves.

## Date

Today is ${todayIso} (${weekday}). Resolve relative dates against it: "today"→${todayIso}, "yesterday"→the day before, "last Friday"→the most recent past Friday, "the 3rd"→the 3rd of the current month if past or today, otherwise last month's. If no date is spoken at all, use ${todayIso}. Always output YYYY-MM-DD.

## Entry type

- "settlement" — one person handing money to another to square up. "I paid Danny fifty bucks", "Timmy sent me 20", "paying Andy back for the tickets". Settlements have a from, a to, and an amount. They are NOT split.
- "expense" — a cost being shared out. Everything else.

An expense where one person happens to owe another is still an expense. Only use settlement when the speech describes a transfer of money to square a debt, not a purchase.

## Restaurant mode — classify conservatively

\`mode\` is "restaurant" ONLY when the speaker gave per-person PRE-TAX amounts AND a separate higher total that includes tax and/or tip. That is the only thing restaurant mode does: it scales each person's pre-tax subtotal up proportionally to reach the real total.

"restaurant" requires BOTH:
  1. Individual per-person amounts that are explicitly described as before tax/tip, as menu prices, or as what each person ordered, AND
  2. A total that is clearly larger and inclusive of tax and/or tip.

Examples that ARE restaurant mode:
  - "I had the steak forty two, Tim had pasta twenty eight, came to ninety five after tax and tip"
  - "my food was 30, Andy's was 25, total with tip 71"

Examples that are NOT restaurant mode — use "standard":
  - "dinner at the steakhouse was 95, split evenly" (a meal, but no per-person pre-tax breakdown)
  - "lunch 40, I paid" (a meal)
  - "Andy owes 20 and Calvin owes 30 of the 50 dinner" (explicit shares that already sum to the total — that is splitMode "explicit", NOT restaurant)
  - anything where the per-person amounts already add up to the stated total

The distinguishing test: in restaurant mode the per-person amounts must sum to LESS than the total, with the gap being tax/tip. If they sum to the total, it is standard/explicit. Being food, a restaurant, or a bar is NOT sufficient. **When in any doubt, use "standard".**

## Splits

- \`splitMode: "even"\` — "split evenly", "split three ways", "between Andy and me", "we all chipped in". List every participant in \`shares\` with amount null.
- \`splitMode: "explicit"\` — the speaker stated what each person owes. Put each amount on its participant.
- \`splitMode: "unspecified"\` — participants named but no division described, or no participants named at all.

"Split between X and Y" includes ONLY X and Y. "Split between all of us" / "everyone" means all ${roster.length} roster members. Someone who paid is not automatically a participant — include the payer in \`shares\` only if the speech implies they consumed part of it (which "split between me and Andy" does, and "I paid for Andy's ticket" does not).

## Amounts

Spoken numbers: "forty bucks"→40, "twenty two fifty"→22.50, "a hundred and twenty"→120, "twelve ninety nine"→12.99. Strip currency words. Output plain numbers in dollars, never strings, never cents.

Negative totals are legitimate — a cashback rebate or refund the payer is giving back. "I'm rebating forty one seventy four of cashback" → totalAmount -41.74. Only go negative when the speech clearly describes a refund, rebate, cashback, or money coming back.

## Multiple entries — be conservative

Set \`multipleEntriesDetected: true\` ONLY when the utterance clearly contains two or more genuinely separate transactions ("lunch was 40 split three ways, AND I paid Danny 20 back"). Then parse ONLY the first one and warn.

These are NOT multiple entries: several participants, several line items in one purchase, one payment split several ways, or a correction of an earlier statement in the same breath. False positives are worse than misses here — default to false.

## Never invent

Leave anything not actually spoken as null or an empty array. A blank field is correct and the user fills it in; a plausible-looking guess is a silent error in someone's money. Do not infer an item name from the venue unless it was named. Do not assume the payer is also a participant. Do not fill a total by adding up shares unless the speaker stated the total.

Use \`warnings\` for anything the user should check: a name you couldn't match, an amount you weren't sure of, a dropped second entry, shares that don't sum to the total. Keep each warning one short sentence, written to the user.`;
}

/** JSON Schema for structured outputs — guarantees a parseable, typed response. */
export const VOICE_ENTRY_JSON_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "entryType",
    "mode",
    "date",
    "item",
    "notes",
    "payers",
    "totalAmount",
    "splitMode",
    "shares",
    "pretaxAmounts",
    "settlementFrom",
    "settlementTo",
    "settlementAmount",
    "multipleEntriesDetected",
    "warnings",
  ],
  properties: {
    entryType: { type: "string", enum: ["expense", "settlement"] },
    mode: { type: "string", enum: ["standard", "restaurant"] },
    date: { type: "string", description: "YYYY-MM-DD" },
    item: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    payers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["userId", "amount"],
        properties: {
          userId: { type: "integer" },
          amount: { type: ["number", "null"] },
        },
      },
    },
    totalAmount: { type: ["number", "null"] },
    splitMode: { type: "string", enum: ["even", "explicit", "unspecified"] },
    shares: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["userId", "amount"],
        properties: {
          userId: { type: "integer" },
          amount: { type: ["number", "null"] },
        },
      },
    },
    pretaxAmounts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["userId", "amount"],
        properties: {
          userId: { type: "integer" },
          amount: { type: ["number", "null"] },
        },
      },
    },
    settlementFrom: { type: ["integer", "null"] },
    settlementTo: { type: ["integer", "null"] },
    settlementAmount: { type: ["number", "null"] },
    multipleEntriesDetected: { type: "boolean" },
    warnings: { type: "array", items: { type: "string" } },
  },
};
