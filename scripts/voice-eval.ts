/**
 * Voice-entry parser eval.
 *
 *   npx tsx scripts/voice-eval.ts              # everything
 *   npx tsx scripts/voice-eval.ts restaurant   # only groups matching a substring
 *   npx tsx scripts/voice-eval.ts item method  # several filters
 *
 * Run this after ANY edit to src/lib/voice/prompt.ts. Most of this feature's
 * behaviour lives in prompt text, where a one-line change silently alters
 * something unrelated — several of the cases below exist because exactly that
 * happened during development.
 *
 * Each model call costs a fraction of a cent; a full run is roughly $0.15.
 * Exits non-zero on any failure so it can gate a deploy.
 */
import { config } from "dotenv";
import path from "node:path";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

const MODEL = "claude-sonnet-5";

const NAMES: Record<number, string> = {
  [-1]: "SPEAKER",
  1: "Andy",
  2: "Calvin",
  3: "Danny",
  4: "Henry",
  5: "Jayden",
  6: "Leon",
  7: "Timmy",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Parsed = any;

interface Case {
  id: string;
  say: string;
  want: string;
  /** Return a list of failure descriptions; empty means pass. */
  check: (p: Parsed) => string[];
}

const truthy = (xs: (string | false | undefined)[]) => xs.filter(Boolean) as string[];
const ids = (xs: { userId: number }[]) => new Set(xs.map((x) => x.userId));
const amountOf = (xs: { userId: number; amount: number | null }[], u: number) =>
  xs.find((x) => x.userId === u)?.amount;
/** Does this string look like a payment method rather than a reason? */
const isMethod = (s: unknown) =>
  typeof s === "string" &&
  /^(cash|e-?transfer|venmo|paypal|bank transfer|zelle|interac|card)$/i.test(s.trim());

async function main() {
  const today = (await import("../src/lib/utils")).todayString();
  const { buildVoiceSystemPrompt, VOICE_ENTRY_JSON_SCHEMA } = await import(
    "../src/lib/voice/prompt"
  );
  const {
    hasSpeakerRef,
    needsPayerChoice,
    resolveSpeaker,
    formItemValue,
    SPEAKER_REF,
  } = await import("../src/lib/voice/schema");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set (see .env)");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildVoiceSystemPrompt(today);

  /** Most recent strictly-past occurrence of a weekday (0=Sun..6=Sat). */
  const lastWeekday = (target: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    do d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() !== target);
    return d.toISOString().slice(0, 10);
  };
  const yesterday = () => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  const GROUPS: Record<string, Case[]> = {
    /* ---------------------------------------------------------------- */
    "item-vs-notes (expense)": [
      {
        id: "venue + trailing remark",
        say: "dinner at Gyukatsu Motomura ninety bucks split three ways between Leon Andy and Calvin, oh and remind Danny he still owes me for the tickets",
        want: 'item="Gyukatsu Motomura", notes=the remark only',
        check: (p) =>
          truthy([
            p.item !== "Gyukatsu Motomura" && `item=${JSON.stringify(p.item)}`,
            !p.notes && "notes empty — remark dropped",
            p.notes && /gyukatsu|motomura/i.test(p.notes) && "venue leaked into notes",
          ]),
      },
      {
        id: "venue + reason",
        say: "Uber to the airport thirty dollars paid by Leon split with Andy, this one was expensive because of surge pricing",
        want: "item=Uber…, notes=surge reason",
        check: (p) =>
          truthy([
            !p.item && "item null",
            p.notes && /uber/i.test(p.notes) && "venue leaked into notes",
            !p.notes && "notes empty",
          ]),
      },
      {
        id: "no remark → notes null",
        say: "Leon paid eighty nine dollars at Gyukatsu Motomura split with Andy and Calvin",
        want: "item set, notes null",
        check: (p) =>
          truthy([!p.item && "item null", p.notes && `notes should be null: ${p.notes}`]),
      },
      {
        id: "method must NOT hijack expense item",
        say: "Leon paid forty in cash for lunch at Sukiya split with Andy",
        want: 'item="Sukiya", never "Cash"',
        check: (p) =>
          truthy([
            isMethod(p.item) && `item=${JSON.stringify(p.item)} — method in an EXPENSE item`,
            !p.item && "item null",
          ]),
      },
    ],

    /* ---------------------------------------------------------------- */
    "item-vs-method (settlement)": [
      {
        id: "method + reason",
        say: "I e-transferred Danny fifty for the hotel deposit",
        want: 'item="e-Transfer" (Method), notes="Hotel deposit"',
        check: (p) =>
          truthy([
            p.entryType !== "settlement" && `type=${p.entryType}`,
            !isMethod(p.item) && `item=${JSON.stringify(p.item)} is not a method`,
            !p.notes && "notes empty — reason lost",
            p.notes && /transfer/i.test(p.notes) && "method leaked into notes",
          ]),
      },
      {
        id: "method only",
        say: "Danny paid me back twenty in cash",
        want: 'item="Cash", notes=null',
        check: (p) =>
          truthy([
            !isMethod(p.item) && `item=${JSON.stringify(p.item)}`,
            p.notes && `notes should be null: ${p.notes}`,
          ]),
      },
      {
        id: "reason but NO method → item null",
        say: "Andy got paid back thirty by Leon for the hotel deposit, that's only part of what he owed",
        want: "item=null (reason must NOT become the method)",
        check: (p) =>
          truthy([
            p.item !== null && `item=${JSON.stringify(p.item)} should be null`,
            !p.notes && "notes empty",
          ]),
      },
      {
        id: "bare settlement",
        say: "I paid Danny fifty",
        want: "item=null, notes=null",
        check: (p) =>
          truthy([
            p.item !== null && `item=${JSON.stringify(p.item)}`,
            p.notes !== null && `notes=${JSON.stringify(p.notes)}`,
          ]),
      },
      {
        id: "venmo + reason",
        say: "Timmy venmo'd Calvin eighty for the concert tickets",
        want: 'item="Venmo", notes=concert tickets',
        check: (p) =>
          truthy([!isMethod(p.item) && `item=${JSON.stringify(p.item)}`, !p.notes && "notes empty"]),
      },
    ],

    /* ---------------------------------------------------------------- */
    "settlement-direction": [
      {
        id: "I paid X",
        say: "I paid Danny fifty bucks",
        want: "SPEAKER → Danny, 50",
        check: (p) =>
          truthy([
            p.entryType !== "settlement" && `type=${p.entryType}`,
            p.settlementFrom !== SPEAKER_REF && `from=${NAMES[p.settlementFrom]}`,
            p.settlementTo !== 3 && `to=${NAMES[p.settlementTo]}`,
            p.settlementAmount !== 50 && `amt=${p.settlementAmount}`,
          ]),
      },
      {
        id: "X paid me back",
        say: "Danny paid me back twenty bucks",
        want: "Danny → SPEAKER, 20",
        check: (p) =>
          truthy([
            p.settlementFrom !== 3 && `from=${NAMES[p.settlementFrom]}`,
            p.settlementTo !== SPEAKER_REF && `to=${NAMES[p.settlementTo]}`,
          ]),
      },
      {
        id: "passive voice (inverts surface order)",
        say: "Andy got paid back thirty by Leon",
        want: "Leon → Andy",
        check: (p) =>
          truthy([
            p.settlementFrom !== 6 && `from=${NAMES[p.settlementFrom]}`,
            p.settlementTo !== 1 && `to=${NAMES[p.settlementTo]}`,
          ]),
      },
      {
        id: "third party",
        say: "Timmy e-transferred Danny a hundred",
        want: "Timmy → Danny, 100",
        check: (p) =>
          truthy([
            p.settlementFrom !== 7 && `from=${NAMES[p.settlementFrom]}`,
            p.settlementTo !== 3 && `to=${NAMES[p.settlementTo]}`,
            p.settlementAmount !== 100 && `amt=${p.settlementAmount}`,
          ]),
      },
      {
        id: "self-correction reverses direction",
        say: "last Friday I paid Tommy, no wait, Tommy paid me, a hundred and twenty",
        want: "Timmy → SPEAKER (the correction)",
        check: (p) =>
          truthy([
            p.settlementFrom !== 7 && `from=${NAMES[p.settlementFrom]}`,
            p.settlementTo !== SPEAKER_REF && `to=${NAMES[p.settlementTo]}`,
            p.settlementAmount !== 120 && `amt=${p.settlementAmount}`,
            p.date !== lastWeekday(5) && `date=${p.date} want ${lastWeekday(5)}`,
          ]),
      },
      {
        id: "debt, not a transfer (documented behaviour)",
        say: "I owe Danny fifty",
        // Confirmed acceptable in manual testing: it records the amount and
        // names, and says in the notes that no money has moved yet.
        want: "amount + people captured; note explains nothing moved",
        check: (p) =>
          truthy([
            p.settlementAmount !== 50 &&
              p.totalAmount !== 50 &&
              `neither settlementAmount nor totalAmount is 50`,
            !p.notes && !p.warnings.length && "no note/warning that no money moved",
          ]),
      },
    ],

    /* ---------------------------------------------------------------- */
    restaurant: [
      {
        id: "true restaurant (parts < total)",
        say: "I had the steak forty two, Tim had pasta twenty eight, came to ninety five after tax and tip",
        want: "restaurant, pretax 42/28, total 95",
        check: (p) =>
          truthy([
            p.mode !== "restaurant" && `mode=${p.mode}`,
            p.totalAmount !== 95 && `total=${p.totalAmount}`,
            p.pretaxAmounts.length !== 2 && `pretax n=${p.pretaxAmounts.length}`,
          ]),
      },
      {
        id: "TRAP: parts sum exactly to total",
        say: "I had forty and Tim had fifty five before tax, total was ninety five, Leon paid",
        want: 'standard — "before tax" wording must not be enough',
        check: (p) => truthy([p.mode !== "standard" && `mode=${p.mode}`]),
      },
      {
        id: "a meal is not restaurant mode",
        say: "dinner at the steakhouse was ninety five, split evenly between me Andy and Calvin",
        want: "standard + even",
        check: (p) =>
          truthy([
            p.mode !== "standard" && `mode=${p.mode}`,
            p.splitMode !== "even" && `split=${p.splitMode}`,
            p.totalAmount !== 95 && `total=${p.totalAmount}`,
          ]),
      },
      {
        id: "explicit shares are not restaurant mode",
        say: "Andy owes twenty and Calvin owes thirty of the fifty dollar dinner",
        want: "standard + explicit",
        check: (p) =>
          truthy([
            p.mode !== "standard" && `mode=${p.mode}`,
            p.splitMode !== "explicit" && `split=${p.splitMode}`,
          ]),
      },
    ],

    /* ---------------------------------------------------------------- */
    splits: [
      {
        id: "everyone except",
        say: "hotel was three hundred, Leon paid, split between everyone except Timmy",
        want: "6 shares, Timmy excluded",
        check: (p) =>
          truthy([
            p.shares.length !== 6 && `shares=${p.shares.length}`,
            ids(p.shares).has(7) && "Timmy included",
          ]),
      },
      {
        id: "multi-payer with 'the rest'",
        say: "Leon put in fifty and Andy put in forty for the ninety dollar dinner split three ways with Calvin",
        want: "Leon 50 + Andy 40, total 90",
        check: (p) =>
          truthy([
            p.payers.length !== 2 && `payers n=${p.payers.length}`,
            amountOf(p.payers, 6) !== 50 && `Leon=${amountOf(p.payers, 6)}`,
            amountOf(p.payers, 1) !== 40 && `Andy=${amountOf(p.payers, 1)}`,
            p.totalAmount !== 90 && `total=${p.totalAmount}`,
          ]),
      },
      {
        id: "percentages → dollars",
        say: "hundred dollar dinner, Danny paid, Leon owes sixty percent and Andy forty percent",
        want: "explicit Leon 60 / Andy 40",
        check: (p) =>
          truthy([
            p.splitMode !== "explicit" && `split=${p.splitMode}`,
            amountOf(p.shares, 6) !== 60 && `Leon=${amountOf(p.shares, 6)}`,
            amountOf(p.shares, 1) !== 40 && `Andy=${amountOf(p.shares, 1)}`,
          ]),
      },
      {
        id: "shares that don't sum → warning",
        say: "Leon paid ninety for dinner, Andy owes thirty and Calvin owes thirty",
        want: "a warning about the 30 gap",
        check: (p) => truthy([p.warnings.length === 0 && "no warning about the shortfall"]),
      },
    ],

    /* ---------------------------------------------------------------- */
    names: [
      {
        id: "mangled but resolvable",
        say: "Tommy paid for the uber, thirty dollars, split with Dani and Jaden",
        want: "Timmy payer; Danny + Jayden in shares",
        check: (p) =>
          truthy([
            p.payers[0]?.userId !== 7 && `payer=${NAMES[p.payers[0]?.userId]}`,
            !ids(p.shares).has(3) && "Danny missing",
            !ids(p.shares).has(5) && "Jayden missing",
          ]),
      },
      {
        id: "unknown name is not invented",
        say: "Jordan paid for lunch forty dollars",
        want: "no person invented + a warning",
        check: (p) =>
          truthy([
            [...p.payers, ...p.shares].length > 0 && "invented a person",
            p.warnings.length === 0 && "no warning about the unmatched name",
          ]),
      },
      {
        id: "one known, one not",
        say: "Tim and Tom split the forty dollar lunch, Tim paid",
        want: "Timmy kept, Tom warned",
        check: (p) =>
          truthy([
            ![...p.payers, ...p.shares].some((x: any) => x.userId === 7) && "Timmy missing",
            p.warnings.length === 0 && "no warning about Tom",
          ]),
      },
    ],

    /* ---------------------------------------------------------------- */
    "speaker-and-payer": [
      {
        id: 'first person emits placeholder',
        say: "lunch forty bucks I paid, split with Andy",
        want: "SPEAKER placeholder present",
        check: (p) => truthy([!hasSpeakerRef(p) && "no SPEAKER ref"]),
      },
      {
        id: "third person emits none",
        say: "Leon paid for dinner sixty dollars, split with Andy",
        want: "no SPEAKER anywhere",
        check: (p) => truthy([hasSpeakerRef(p) && "SPEAKER leaked into 3rd-person speech"]),
      },
      {
        id: "missing payer is detected",
        say: "dinner at the steakhouse was ninety five dollars split evenly between Andy Calvin and Danny",
        want: "needsPayer true",
        check: (p) => truthy([!needsPayerChoice(p) && "needsPayer false"]),
      },
      {
        id: "stated payer needs no prompt",
        say: "Leon paid sixty for lunch split with Andy",
        want: "needsPayer false",
        check: (p) => truthy([needsPayerChoice(p) && "needsPayer true"]),
      },
      {
        id: 'resolving "I paid" also supplies the payer',
        say: "I paid forty for lunch split with Andy",
        want: "after resolution, no payer prompt",
        check: (p) =>
          truthy([
            !hasSpeakerRef(p) && "no SPEAKER ref",
            needsPayerChoice(resolveSpeaker(p, 6)) && "still needs a payer after resolving",
          ]),
      },
    ],

    /* ---------------------------------------------------------------- */
    "multi-entry": [
      {
        id: "genuine two entries",
        say: "lunch was forty split three ways between me Andy and Calvin, and also I paid Danny twenty back",
        want: "flagged",
        check: (p) => truthy([!p.multipleEntriesDetected && "not flagged"]),
      },
      {
        id: "many line items is ONE entry",
        say: "I bought groceries, milk eggs and bread, forty dollars total, split with Henry",
        want: "not flagged",
        check: (p) => truthy([p.multipleEntriesDetected && "false positive"]),
      },
      {
        id: "many participants is ONE entry",
        say: "Leon paid ninety for the hotel split between Andy Calvin Danny and Henry",
        want: "not flagged",
        check: (p) => truthy([p.multipleEntriesDetected && "false positive"]),
      },
      {
        id: "long rambling single entry",
        say: "so we went to the supermarket and got milk bread eggs some chicken and a bag of rice and also picked up detergent and paper towels, came to eighty seven fifty, Leon paid, split between Leon and Henry",
        want: "not flagged, total 87.50",
        check: (p) =>
          truthy([
            p.multipleEntriesDetected && "false positive",
            p.totalAmount !== 87.5 && `total=${p.totalAmount}`,
          ]),
      },
    ],

    /* ---------------------------------------------------------------- */
    dates: [
      {
        id: "yesterday + everyone",
        say: "yesterday Leon paid ninety for the hotel split between everyone",
        want: `${yesterday()}, 7 shares`,
        check: (p) =>
          truthy([
            p.date !== yesterday() && `date=${p.date} want ${yesterday()}`,
            p.shares.length !== 7 && `shares=${p.shares.length}`,
          ]),
      },
      {
        id: "last Tuesday",
        say: "last Tuesday Leon paid sixty for lunch with Andy",
        want: lastWeekday(2),
        check: (p) => truthy([p.date !== lastWeekday(2) && `date=${p.date}`]),
      },
      {
        id: "no date stated → today",
        say: "Leon paid twenty for coffee split with Andy",
        want: today,
        check: (p) => truthy([p.date !== today && `date=${p.date}`]),
      },
    ],

    /* ---------------------------------------------------------------- */
    amounts: [
      {
        id: "rebate goes negative",
        say: "Leon is rebating forty one dollars seventy four cents of cashback split evenly between Leon Timmy and Danny",
        want: "-41.74",
        check: (p) => truthy([p.totalAmount !== -41.74 && `total=${p.totalAmount}`]),
      },
      {
        id: "self-corrected amount",
        say: "lunch was forty, no wait forty five, split between me and Andy",
        want: "45, not flagged as multi",
        check: (p) =>
          truthy([
            p.totalAmount !== 45 && `total=${p.totalAmount}`,
            p.multipleEntriesDetected && "false multi",
          ]),
      },
      {
        id: "self-corrected payer",
        say: "Andy paid, sorry, Calvin paid, eighty for dinner split with Danny",
        want: "payer Calvin",
        check: (p) =>
          truthy([
            p.payers[0]?.userId !== 2 && `payer=${NAMES[p.payers[0]?.userId]}`,
            p.multipleEntriesDetected && "false multi",
          ]),
      },
      {
        id: "digits in the venue name",
        say: "seven eleven, twelve dollars, I paid, split with Henry",
        want: "total 12 (not 7 or 711)",
        check: (p) => truthy([p.totalAmount !== 12 && `total=${p.totalAmount}`, !p.item && "item null"]),
      },
      {
        id: "heavy disfluency",
        say: "uh so like Leon um paid for the the hotel like three hundred bucks I think split four ways between Leon Andy Calvin and Danny",
        want: "Leon, 300, 4 shares",
        check: (p) =>
          truthy([
            p.payers[0]?.userId !== 6 && `payer=${NAMES[p.payers[0]?.userId]}`,
            p.totalAmount !== 300 && `total=${p.totalAmount}`,
            p.shares.length !== 4 && `shares=${p.shares.length}`,
          ]),
      },
    ],
  };

  /* ------------------------------------------------------------------ */
  /* Pure-function assertions — no model call, no cost.                  */
  /* ------------------------------------------------------------------ */
  const unit: [string, boolean][] = [
    [
      "settlement with no method falls back to 'Settlement'",
      formItemValue({ entryType: "settlement", item: null } as Parsed) === "Settlement",
    ],
    [
      "settlement WITH a method keeps it",
      formItemValue({ entryType: "settlement", item: "e-Transfer" } as Parsed) === "e-Transfer",
    ],
    [
      "blank-ish method still falls back",
      formItemValue({ entryType: "settlement", item: "   " } as Parsed) === "Settlement",
    ],
    [
      "expense with no item stays blank (no fallback)",
      formItemValue({ entryType: "expense", item: null } as Parsed) === "",
    ],
    [
      "expense keeps its item",
      formItemValue({ entryType: "expense", item: "Sukiya" } as Parsed) === "Sukiya",
    ],
  ];

  /* ------------------------------------------------------------------ */
  const filters = process.argv.slice(2).map((s) => s.toLowerCase());
  const groups = Object.entries(GROUPS).filter(
    ([name]) => filters.length === 0 || filters.some((f) => name.toLowerCase().includes(f))
  );
  if (groups.length === 0) {
    console.error(`No groups match ${filters.join(", ")}. Available:`);
    Object.keys(GROUPS).forEach((g) => console.error(`  ${g}`));
    process.exit(1);
  }

  let pass = 0;
  let fail = 0;
  let cost = 0;

  console.log(`model=${MODEL}  today=${today}`);

  if (filters.length === 0) {
    console.log(`\n── unit (no API calls) ${"─".repeat(42)}`);
    for (const [name, ok] of unit) {
      ok ? pass++ : fail++;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    }
  }

  for (const [group, cases] of groups) {
    console.log(`\n── ${group} ${"─".repeat(Math.max(0, 60 - group.length))}`);
    for (const c of cases) {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        thinking: { type: "adaptive" },
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: VOICE_ENTRY_JSON_SCHEMA },
        },
        messages: [{ role: "user", content: `Parse this dictated entry:\n\n"""${c.say}"""` }],
      });
      const block = message.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") {
        fail++;
        console.log(`  FAIL  ${c.id} — no text block returned`);
        continue;
      }
      const parsed = JSON.parse(block.text);
      const u = message.usage as any;
      cost +=
        (u.input_tokens * 3 + (u.cache_read_input_tokens ?? 0) * 0.3 + u.output_tokens * 15) / 1e6;

      const errs = c.check(parsed);
      errs.length ? fail++ : pass++;
      console.log(`  ${errs.length ? "FAIL" : "PASS"}  ${c.id}`);
      if (errs.length) {
        console.log(`        want: ${c.want}`);
        console.log(`        said: "${c.say.slice(0, 92)}${c.say.length > 92 ? "…" : ""}"`);
        console.log(
          `        got : ${parsed.entryType}/${parsed.mode}/${parsed.splitMode} ` +
            `item=${JSON.stringify(parsed.item)} notes=${JSON.stringify(parsed.notes)} total=${parsed.totalAmount}`
        );
        console.log(`        >>>  ${errs.join(" | ")}`);
      }
    }
  }

  console.log(
    `\n${pass}/${pass + fail} passed   approx cost $${cost.toFixed(3)}` +
      (fail ? `   — ${fail} FAILURE${fail > 1 ? "S" : ""}` : "")
  );
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
