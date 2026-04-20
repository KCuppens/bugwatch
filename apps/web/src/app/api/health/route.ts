import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  let backendStatus: "ok" | "unreachable" = "unreachable";

  if (apiUrl) {
    try {
      const res = await fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });
      if (res.ok) backendStatus = "ok";
    } catch {
      // backend unreachable — status stays "unreachable"
    }
  }

  const healthy = backendStatus === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", backend: backendStatus },
    { status: healthy ? 200 : 503 }
  );
}
