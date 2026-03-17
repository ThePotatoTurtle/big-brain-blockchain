import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploaded = await Promise.all(
      files.map(async (file) => {
        const blob = await put(file.name, file, {
          access: "public",
        });
        return {
          fileUrl: blob.url,
          fileName: file.name,
        };
      })
    );

    return NextResponse.json({ files: uploaded });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Failed to upload files:", msg);
    return NextResponse.json(
      { error: `Failed to upload files: ${msg}` },
      { status: 500 }
    );
  }
}
