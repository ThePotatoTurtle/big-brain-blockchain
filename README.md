# Big Brain Blockchain

A shared expense ledger for a fixed group of seven friends. Nobody hands anybody cash — purchases get logged, split, and netted off, and the running balances tell you who owes whom.

Despite the name, there is no blockchain. The only thing it borrows is the idea of an append-only shared ledger everyone can see.

## How it works

Every transaction stores one `TransactionLine` per person holding their **net** position — what they paid minus what they owe. Those lines always sum to zero, so balances are just a sum over the lines and the books can't silently drift. Amounts are integer minor units (cents for CAD, whole yen for JPY), never floats.

## What's in it

**Entries** — Expenses split evenly, by explicit per-person amounts, or in *restaurant mode*, which scales each person's pre-tax subtotal up to a tax- and tip-inclusive total. Settlements record a straight transfer between two people. Negative totals are supported for cashback rebates and refunds. Multiple payers on one expense work too.

**Receipt scanning** — Photograph a receipt and Claude extracts the line items, tax, and total. Assign each item to whoever ate it and the split is computed pro-rata.

**Voice entry** — Dictate an entry and it fills the form: *"Leon paid ninety at Gyukatsu Motomura, split three ways with Andy and Calvin."* Audio is transcribed via OpenRouter, then parsed by Claude into dates, amounts, people, and splits. It resolves mangled names against the roster, asks who "I" is when you use first person, and flags anything it wasn't sure about. Nothing is ever submitted automatically — the form is filled and you review it.

**Trips** — Self-contained sub-ledgers for a holiday, with their own members, categories, payment methods, and currencies. Spend in JPY and CAD side by side, convert foreign balances at a rate you supply, then transfer the settled total into the main ledger in one move. Trip configs are plain TypeScript files, so adding a new trip is a copy-paste.

**Charts and history** — Balance history per person over time, with a symmetric-log axis option so one large balance doesn't flatten everyone else into a line.

**Discord notifications** — Every add, edit, and delete posts to a webhook. Large transactions also get a rendered balance-history chart attached as a PNG.

Plus receipt/attachment uploads, nine colour themes, and mobile-first layouts throughout.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma 7 on Neon Postgres · Recharts · Vercel Blob · Claude and OpenRouter for the AI features · deployed on Vercel.

## Environment variables

Set these in `.env` locally and under **Vercel → Project → Settings → Environment Variables** for deploys.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | Prisma | Neon pooled connection string |
| `DIRECT_DATABASE_URL` | Prisma | Neon direct connection, for migrations |
| `BLOB_READ_WRITE_TOKEN` | Receipt/attachment uploads | Vercel Blob |
| `RESEND_API_KEY` | Email | |
| `ANTHROPIC_API_KEY` | Receipt scanning, voice-entry parsing | Both call `claude-sonnet-5` |
| `OPENROUTER_API_KEY` | Voice entry (speech-to-text) | Transcription via `microsoft/mai-transcribe-2` |

Voice entry needs **both** `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` — transcription and parsing are separate hops. Neither key reaches the browser; both are read server-side in the API routes only. Recorded audio is held in memory for the length of the request and never written to Blob storage, the database, or logs.

## Getting started

```bash
npm install
npx prisma generate
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Testing the voice parser

Most of the voice feature's behaviour lives in a system prompt, where a one-line edit can silently change something unrelated. There's an eval suite for exactly that:

```bash
npm run voice-eval              # all 48 cases (~$0.20 in API calls)
npm run voice-eval -- item      # just the item/notes and item/method groups
```

Run it after **any** change to `src/lib/voice/prompt.ts`. It exits non-zero on failure.
