import { NextResponse } from "next/server";
import { recordInstallEvent } from "@/server/db/ingest";
import { installEventSchema } from "@/server/telemetry/types";

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { accepted: false, ignoredReason: "invalid_json" },
      { status: 202 },
    );
  }

  const parsed = installEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        accepted: false,
        ignoredReason: "invalid_payload",
        errors: parsed.error.flatten(),
      },
      { status: 202 },
    );
  }

  try {
    const result = await recordInstallEvent({
      payload: parsed.data,
      context: {
        ip: getClientIp(request),
        userAgent: request.headers.get("user-agent") ?? "unknown",
      },
    });

    return NextResponse.json(result, { status: 202 });
  } catch {
    return NextResponse.json(
      { accepted: false, ignoredReason: "ingest_failed" },
      { status: 202 },
    );
  }
}
