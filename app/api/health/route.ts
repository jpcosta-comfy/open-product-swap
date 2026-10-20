import { NextResponse } from "next/server";
import { pingComfy } from "@/lib/comfy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ping = await pingComfy();
    return NextResponse.json({
      ok: ping.ok,
      cloud: ping.cloudVersion ?? null,
      hasKey: Boolean(process.env.COMFY_API_KEY),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "health check failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
