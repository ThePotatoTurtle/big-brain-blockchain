# Big Brain Blockchain

A shared expense ledger for a small group of friends. Nobody hands over cash. You log what you bought and who it was for, and the running balances work out who owes whom.

There's no blockchain in it. The name stuck from a group chat.

## How it works

Each transaction stores one row per person holding their net position, meaning what they paid minus what they owe. Those rows always add up to zero, so a balance is just a sum over them and the books can't quietly drift. Money is kept as integer minor units (cents, or whole yen), never floats.

## Features

**Entries.** Split an expense evenly, type in each person's share by hand, or use restaurant mode, which takes everyone's pre-tax subtotal and scales it up to the real total after tax and tip. Settlements are a straight transfer between two people. Negative amounts work for cashback rebates and refunds, and one expense can have more than one payer.

**Receipt scanning.** Photograph a receipt and Claude pulls out the line items, tax and total. Tick off who had what and it works out each share pro rata.

**Voice entry.** Hit the mic and say something like "paid ninety at the ramen place, split three ways". OpenRouter transcribes it, then Claude turns that into a date, an amount, people and a split. It matches misheard names against the group, asks who you are if you say "I", and warns about anything it wasn't sure of. It only fills the form in. You still check it and hit submit yourself.

**Trips.** A trip is its own sub-ledger with its own members, categories, payment methods and currencies. Spend in two currencies at once, convert the foreign balance at whatever rate you actually got, then move the result into the main ledger in one step. Trip configs are plain TypeScript files, so adding one is a copy and paste.

**Charts.** Balance history per person. There's a log scale option, because once someone is a few thousand ahead a linear axis squashes everyone else flat.

**Discord.** Adds, edits and deletes all post to a webhook. Anything over $100 also gets a balance chart rendered and attached as an image.

There's also file attachments on entries, a few colour themes, and the whole thing is built mobile first.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Prisma 7 against Neon Postgres, Recharts, Vercel Blob. Claude and OpenRouter handle the AI parts. Hosted on Vercel.

## Environment variables

Set these in `.env` locally, and under **Vercel → Project → Settings → Environment Variables** for deploys.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | Prisma | Neon pooled connection string |
| `DIRECT_DATABASE_URL` | Prisma | Neon direct connection, for migrations |
| `BLOB_READ_WRITE_TOKEN` | Receipt/attachment uploads | Vercel Blob |
| `RESEND_API_KEY` | Email | |
| `ANTHROPIC_API_KEY` | Receipt scanning, voice-entry parsing | Both call `claude-sonnet-5` |
| `OPENROUTER_API_KEY` | Voice entry (speech-to-text) | Transcription via `microsoft/mai-transcribe-2` |

Voice entry needs both `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY`, since transcribing and parsing are separate calls. Neither key reaches the browser. Both are read server side in the API routes only. Recorded audio stays in memory for the length of the request and is never written to Blob storage, the database, or the logs.

## Getting started

```bash
npm install
npx prisma generate
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Testing the voice parser

Most of how voice entry behaves lives in a system prompt, where changing one line can quietly break something unrelated. There's an eval for that:

```bash
npm run voice-eval              # all 48 cases, about $0.20 in API calls
npm run voice-eval -- item      # just the item/notes and item/method groups
```

Run it after any change to `src/lib/voice/prompt.ts`. It exits non-zero if anything fails.
