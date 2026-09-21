import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/**
 * POST /api/receipt-scan
 *
 * Extracts line items and totals from a receipt photo.
 *
 * Uses structured outputs rather than regex-scraping JSON out of the reply, so
 * a malformed response is impossible by construction — the previous
 * `/\{[\s\S]*\}/` match would happily capture a partial object.
 */

export const maxDuration = 60;

const RECEIPT_JSON_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "supplierName",
    "date",
    "totalAmount",
    "tip",
    "totalTax",
    "totalNet",
    "lineItems",
  ],
  properties: {
    supplierName: { type: ["string", "null"], description: "Restaurant or store name" },
    date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    totalAmount: { type: ["number", "null"], description: "Final total paid" },
    tip: { type: ["number", "null"] },
    totalTax: { type: ["number", "null"] },
    totalNet: { type: ["number", "null"], description: "Subtotal before tax" },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unitPrice", "totalAmount"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unitPrice: { type: ["number", "null"] },
          totalAmount: { type: ["number", "null"] },
        },
      },
    },
  },
};

interface ParsedReceipt {
  supplierName: string | null;
  date: string | null;
  totalAmount: number | null;
  tip: number | null;
  totalTax: number | null;
  totalNet: number | null;
  lineItems: {
    description: string;
    quantity: number;
    unitPrice: number | null;
    totalAmount: number | null;
  }[];
}

export async function POST(request: NextRequest) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Anthropic API key not configured" },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File too large (max 25MB)" },
      { status: 400 }
    );
  }

  const mimeType = file.type || "image/jpeg";
  if (!mimeType.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RECEIPT_JSON_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
                data: base64,
              },
            },
            {
              type: "text",
              text: `Extract all data from this receipt image.

All prices are plain numbers in the receipt's currency (12.50, not "$12.50"). Extract every individual line item you can see. Use null for anything not shown on the receipt rather than estimating it — a missing value is better than an invented one.`,
            },
          ],
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      return NextResponse.json({ error: "Could not read this receipt" }, { status: 422 });
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "Could not parse receipt" }, { status: 422 });
    }

    const parsed = JSON.parse(textBlock.text) as ParsedReceipt;

    return NextResponse.json({
      supplierName: parsed.supplierName ?? null,
      date: parsed.date ?? null,
      totalAmount: parsed.totalAmount ?? null,
      tip: parsed.tip ?? null,
      totalTax: parsed.totalTax ?? null,
      totalNet: parsed.totalNet ?? null,
      lineItems: (parsed.lineItems ?? []).map((li) => ({
        description: li.description ?? "Item",
        quantity: li.quantity ?? 1,
        unitPrice: li.unitPrice ?? null,
        totalAmount: li.totalAmount ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error("Receipt scan API error:", err.status, err.message);
    } else {
      console.error("Receipt scan error:", err);
    }
    return NextResponse.json({ error: "Receipt scan failed" }, { status: 502 });
  }
}
