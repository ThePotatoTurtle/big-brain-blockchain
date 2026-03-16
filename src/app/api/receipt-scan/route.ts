import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const MINDEE_API_KEY = process.env.MINDEE_API_KEY;
  if (!MINDEE_API_KEY) {
    return NextResponse.json(
      { error: "Mindee API key not configured" },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // 10MB limit
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File too large (max 10MB)" },
      { status: 400 }
    );
  }

  try {
    const mindeeForm = new FormData();
    mindeeForm.append("document", file);

    const mindeeRes = await fetch(
      "https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict",
      {
        method: "POST",
        headers: { Authorization: `Token ${MINDEE_API_KEY}` },
        body: mindeeForm,
      }
    );

    if (!mindeeRes.ok) {
      const text = await mindeeRes.text();
      console.error("Mindee API error:", mindeeRes.status, text);
      return NextResponse.json(
        { error: "Receipt scan failed" },
        { status: 502 }
      );
    }

    const mindeeData = await mindeeRes.json();
    const prediction = mindeeData.document?.inference?.prediction;

    if (!prediction) {
      return NextResponse.json(
        { error: "Could not parse receipt" },
        { status: 422 }
      );
    }

    const result = {
      supplierName: prediction.supplier_name?.value ?? null,
      date: prediction.date?.value ?? null,
      totalAmount: prediction.total_amount?.value ?? null,
      tip: prediction.tip?.value ?? null,
      totalTax: prediction.total_tax?.value ?? null,
      totalNet: prediction.total_net?.value ?? null,
      lineItems: (prediction.line_items ?? []).map((li: Record<string, unknown>) => ({
        description: (li.description as string) ?? "Item",
        quantity: (li.quantity as number) ?? 1,
        unitPrice: (li.unit_price as number) ?? null,
        totalAmount: (li.total_amount as number) ?? null,
      })),
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
