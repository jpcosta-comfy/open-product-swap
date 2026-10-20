import { NextResponse } from "next/server";
import { downloadOutput } from "@/lib/comfy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const filename = url.searchParams.get("filename");
    if (!filename) {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }
    const file = await downloadOutput({
      filename,
      subfolder: url.searchParams.get("subfolder") || "",
      type: url.searchParams.get("type") || "output",
    });
    const headers = new Headers();
    headers.set("Content-Type", file.contentType);
    headers.set("Cache-Control", "private, max-age=300");
    headers.set(
      "Content-Disposition",
      `inline; filename="${filename.replace(/"/g, "")}"`,
    );
    return new NextResponse(file.bytes, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
