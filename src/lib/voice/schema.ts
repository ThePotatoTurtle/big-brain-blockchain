/**
 * Shape of a voice-dictated entry, shared between the parser route and the UI.
 *
 * Two deliberate properties:
 *
 *  - `SPEAKER_REF` is a placeholder the model emits when the speaker refers to
 *    themselves ("I paid", "my share", "we split it"). The app has no logged-in
 *    user, so "I" is genuinely unresolvable server-side — the UI asks who the
 *    speaker is and substitutes before anything reaches the form. It is NOT
 *    inferred from the remembered last-payer setting, because people routinely
 *    enter transactions on someone else's behalf.
 *
 *  - Everything is nullable. Unheard fields stay blank so the user fills them
 *    in manually; the parser must never invent a value to look complete.
 */

/** Placeholder user reference meaning "whoever is talking". */
export const SPEAKER_REF = -1;

/** A user id from USERS, or SPEAKER_REF when the speaker meant themselves. */
export type UserRef = number;

export interface VoicePerson {
  /** User id, or SPEAKER_REF (-1). */
  userId: UserRef;
  /** Dollars. Null when the speaker didn't state an amount for this person. */
  amount: number | null;
}

export interface VoiceParsedEntry {
  entryType: "expense" | "settlement";
  /**
   * "restaurant" ONLY when the speaker clearly described per-person pre-tax
   * amounts that need scaling up to a tax/tip-inclusive total. Being a meal is
   * not sufficient — see the system prompt's classifier.
   */
  mode: "standard" | "restaurant";
  /** YYYY-MM-DD. Defaults to today when unstated. */
  date: string;
  item: string | null;
  notes: string | null;

  /** Expense: who paid. Empty when unheard. */
  payers: VoicePerson[];
  /** Expense: grand total in dollars. Negative for a rebate/refund. */
  totalAmount: number | null;

  /**
   * How the cost is divided.
   *  - "even"        → split equally between everyone in `shares`
   *  - "explicit"    → each entry in `shares` carries its own amount
   *  - "unspecified" → participants heard but no division stated
   */
  splitMode: "even" | "explicit" | "unspecified";
  /** Who the expense is split among. Amounts only set when splitMode is "explicit". */
  shares: VoicePerson[];
  /** Restaurant mode only: per-person pre-tax subtotals. */
  pretaxAmounts: VoicePerson[];

  /** Settlement: payer → payee, and the amount handed over. */
  settlementFrom: UserRef | null;
  settlementTo: UserRef | null;
  settlementAmount: number | null;

  /**
   * True when the utterance plausibly described more than one distinct entry.
   * Only the first/primary one is filled in. Deliberately conservative — a
   * single entry with several participants or line items is NOT multiple.
   */
  multipleEntriesDetected: boolean;
  /** Short, user-facing notes about anything uncertain or dropped. */
  warnings: string[];
}

export interface VoiceEntryResponse {
  transcript: string;
  parsed: VoiceParsedEntry;
  /** True when any field resolved to SPEAKER_REF and the UI must ask who "I" is. */
  needsSpeakerIdentity: boolean;
  /**
   * True when nobody was named as having paid. Distinct from the SPEAKER case:
   * the speech may be entirely third-person and still not say who paid. The
   * payer is mandatory on the form, so the UI asks rather than filling a blank
   * the user then has to notice.
   */
  needsPayer: boolean;
}

/** Every place a UserRef can appear, for SPEAKER_REF detection and substitution. */
function collectRefs(p: VoiceParsedEntry): UserRef[] {
  return [
    ...p.payers.map((x) => x.userId),
    ...p.shares.map((x) => x.userId),
    ...p.pretaxAmounts.map((x) => x.userId),
    ...(p.settlementFrom === null ? [] : [p.settlementFrom]),
    ...(p.settlementTo === null ? [] : [p.settlementTo]),
  ];
}

export function hasSpeakerRef(p: VoiceParsedEntry): boolean {
  return collectRefs(p).includes(SPEAKER_REF);
}

/** Replace every SPEAKER_REF with a real user id, once the UI has asked. */
export function resolveSpeaker(
  p: VoiceParsedEntry,
  speakerUserId: number
): VoiceParsedEntry {
  const sub = (id: UserRef) => (id === SPEAKER_REF ? speakerUserId : id);
  const subPeople = (people: VoicePerson[]) => {
    // Substituting can collide with someone the speaker also named explicitly
    // ("Leon and I split it" when the speaker IS Leon) — merge rather than
    // producing a duplicate row the form can't represent.
    const merged: VoicePerson[] = [];
    for (const person of people) {
      const userId = sub(person.userId);
      const existing = merged.find((m) => m.userId === userId);
      if (!existing) {
        merged.push({ userId, amount: person.amount });
        continue;
      }
      if (person.amount !== null) {
        existing.amount = (existing.amount ?? 0) + person.amount;
      }
    }
    return merged;
  };

  return {
    ...p,
    payers: subPeople(p.payers),
    shares: subPeople(p.shares),
    pretaxAmounts: subPeople(p.pretaxAmounts),
    settlementFrom: p.settlementFrom === null ? null : sub(p.settlementFrom),
    settlementTo: p.settlementTo === null ? null : sub(p.settlementTo),
  };
}

/**
 * True when the entry names nobody as payer. Checked AFTER speaker resolution,
 * since "I paid" resolves to a real person and no longer counts as missing.
 */
export function needsPayerChoice(p: VoiceParsedEntry): boolean {
  if (p.entryType === "settlement") return p.settlementFrom === null;
  return p.payers.filter((x) => x.userId !== 0).length === 0;
}

/** Set the payer the UI asked for, without disturbing anything else. */
export function withPayer(p: VoiceParsedEntry, userId: number): VoiceParsedEntry {
  if (p.entryType === "settlement") return { ...p, settlementFrom: userId };
  // A sole payer covers the whole total; per-payer amounts only matter when
  // several people paid, which the speech would have had to state.
  return { ...p, payers: [{ userId, amount: p.totalAmount }] };
}

/** Shown in a settlement's "Method" box when the speaker named no method. */
export const DEFAULT_SETTLEMENT_METHOD = "Settlement";

/**
 * What belongs in the form's Item/Method box.
 *
 * The settlement form reuses the `item` field relabelled "Method", and requires
 * it before it will submit. The parser correctly leaves it null when no method
 * was spoken — it must not invent one — so the neutral fallback is applied here
 * instead, at the UI boundary. Expenses get no fallback: there is no sensible
 * default for "what was this", and a blank is the honest prompt to fill it in.
 */
export function formItemValue(p: VoiceParsedEntry): string {
  const spoken = p.item?.trim();
  if (spoken) return spoken;
  return p.entryType === "settlement" ? DEFAULT_SETTLEMENT_METHOD : "";
}
