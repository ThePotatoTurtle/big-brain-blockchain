This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment variables

Set these in `.env` locally and under **Vercel → Project → Settings → Environment Variables** for deploys.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | Prisma | Neon pooled connection string |
| `DIRECT_DATABASE_URL` | Prisma | Neon direct connection, for migrations |
| `BLOB_READ_WRITE_TOKEN` | Receipt/attachment uploads | Vercel Blob |
| `RESEND_API_KEY` | Email | |
| `ANTHROPIC_API_KEY` | Receipt scanning, voice-entry parsing | Both call `claude-opus-5` |
| `OPENROUTER_API_KEY` | Voice entry (speech-to-text) | Transcription via `microsoft/mai-transcribe-2` |

Voice entry needs **both** `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` — transcription and parsing are separate hops. Neither key reaches the browser; both are read server-side in the API routes only. Recorded audio is held in memory for the length of the request and never written to Blob storage, the database, or logs.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
