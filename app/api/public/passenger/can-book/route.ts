import { NextResponse } from "next/server";

type CanBookReq = {
  town?: string | null;
  service?: string | null;
  verified?: boolean | null;
};

function manilaNowParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return { hour, minute };
}

function isNightGateNow() {
  const { hour } = manilaNowParts();
  // Night gate window: 20:00 - 05:00 (Asia/Manila)
  return hour >= 20 || hour < 5;
}

export async function GET() {
  const nightGate = isNightGateNow();
  return NextResponse.json(
    {
      ok: true,
      nightGate,
      window: "20:00-05:00 Asia/Manila",
      note: "POST with { verified:true } bypasses night gate temporarily (will be wired to passengers verification tier).",
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CanBookReq;

  const nightGate = isNightGateNow();
  const verified = !!body.verified;

  if (nightGate && !verified) {
    return NextResponse.json(
      {
        ok: false,
        code: "NIGHT_GATE_UNVERIFIED",
        message: "Booking is restricted from 8PM to 5AM unless verified.",
        nightGate: true,
        window: "20:00-05:00 Asia/Manila",
      },
      { status: 403 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      nightGate,
      allowed: true,
      town: body.town ?? null,
      service: body.service ?? null,
      verified,
    },
    { status: 200 }
  );
}