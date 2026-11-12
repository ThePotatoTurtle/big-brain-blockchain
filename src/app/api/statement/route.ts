import { NextRequest, NextResponse } from "next/server";
import { getUserById } from "@/lib/users";
import { getPersonStatement } from "@/lib/statement";

export async function GET(request: NextRequest) {
  const userId = Number(new URL(request.url).searchParams.get("user"));
  if (!getUserById(userId)) {
    return NextResponse.json({ error: "Unknown user" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getPersonStatement(userId));
  } catch (error) {
    console.error("Failed to fetch statement:", error);
    return NextResponse.json({ error: "Failed to fetch statement" }, { status: 500 });
  }
}
