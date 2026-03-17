import { NextRequest, NextResponse } from "next/server";

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

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File too large (max 10MB)" },
      { status: 400 }
    );
  }

  try {
    // Convert file to base64
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Determine media type
    const mimeType = file.type || "image/jpeg";
    if (!mimeType.startsWith("image/")) {
      return NextResponse.json(
        { error: "File must be an image" },
        { status: 400 }
      );
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: base64,
                },
              },
              {
                type: "text",
                text: `Extract all data from this receipt image. Return ONLY valid JSON with this exact structure, no other text:
{
  "supplierName": "restaurant or store name" or null,
  "date": "YYYY-MM-DD" or null,
  "totalAmount": number or null (final total paid),
  "tip": number or null,
  "totalTax": number or null,
  "totalNet": number or null (subtotal before tax),
  "lineItems": [
    {
      "description": "item name",
      "quantity": number (default 1),
      "unitPrice": number or null (price per unit),
      "totalAmount": number or null (line total)
    }
  ]
}
All prices should be plain numbers (e.g. 12.50 not "$12.50"). Extract every individual line item you can see on the receipt.`,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Anthropic API error:", res.status, text);
      return NextResponse.json(
        { error: "Receipt scan failed" },
        { status: 502 }
      );
    }

    const data = await res.json();
    const responseText = data.content?.[0]?.text ?? "";

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Could not parse Claude response:", responseText);
      return NextResponse.json(
        { error: "Could not parse receipt" },
        { status: 422 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Normalize to expected format
    const result = {
      supplierName: parsed.supplierName ?? null,
      date: parsed.date ?? null,
      totalAmount: parsed.totalAmount ?? null,
      tip: parsed.tip ?? null,
      totalTax: parsed.totalTax ?? null,
      totalNet: parsed.totalNet ?? null,
      lineItems: (parsed.lineItems ?? []).map(
        (li: Record<string, unknown>) => ({
          description: (li.description as string) ?? "Item",
          quantity: (li.quantity as number) ?? 1,
          unitPrice: (li.unitPrice as number) ?? null,
          totalAmount: (li.totalAmount as number) ?? null,
        })
      ),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("Receipt scan error:", err);
    return NextResponse.json(
      { error: "Receipt scan failed" },
      { status: 500 }
    );
  }
}
