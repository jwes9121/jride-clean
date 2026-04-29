import { NextResponse } from "next/server";
import { requirePartnerAccess } from "@/lib/partner-access";

export async function GET() {
  const gate = await requirePartnerAccess();

  if (!gate.ok) {
    return NextResponse.json(gate, { status: gate.status });
  }

  const access = Array.isArray(gate.access) ? gate.access : [];

  return NextResponse.json({
    ok: true,
    user: gate.user,
    territories: access
  });
}
