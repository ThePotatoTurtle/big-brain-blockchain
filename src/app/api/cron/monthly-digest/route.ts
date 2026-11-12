import { NextRequest, NextResponse } from "next/server";
import { buildMonthlyDigest, previousMonth } from "@/lib/digest";
import { sendMonthlyDigest } from "@/lib/discord";

// The chart render can be slow on a cold start
export const maxDuration = 60;

/**
 * Monthly Discord digest, triggered by the Vercel cron in vercel.json.
 *
 *   ?month=YYYY-MM  summarise that month instead of the previous one
 *   ?dryRun=1       return the digest as JSON without posting
 *
 * When CRON_SECRET is set, posting requires the bearer token Vercel's cron sends.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dryRun") === "1";

  const secret = process.env.CRON_SECRET;
  if (!dryRun && secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const month = searchParams.get("month") ?? previousMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  try {
    const digest = await buildMonthlyDigest(month);
    if (dryRun) return NextResponse.json({ month, digest });
    if (!digest) return NextResponse.json({ month, posted: false, reason: "No entries that month" });

    await sendMonthlyDigest(digest);
    return NextResponse.json({ month, posted: true });
  } catch (error) {
    console.error("Monthly digest failed:", error);
    return NextResponse.json({ error: "Monthly digest failed" }, { status: 500 });
  }
}
