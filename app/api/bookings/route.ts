import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { computeTriplycFare } from "../../../lib/fare";

type CreateBookingBody = {
  mode?: string;         // 'tricycle' | 'motorcycle'
  passengers?: number;
  origin?: string;
  destination?: string;
};

export async function GET() {
  // we allow GET to prove the route works and session can be read
  const session = await auth();

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  return NextResponse.json(
    { ok: true, user: session.user },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const session = await auth();

  if (!session || !session.user?.email) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = (await req.json()) as CreateBookingBody;

  // Use our stub fare calculator so build succeeds.
  const fareQuote = computeTriplycFare(
    body.origin ?? "",
    body.destination ?? "",
    body.passengers ?? 1
  );

  // Stub response for now
  return NextResponse.json(
    {
      ok: true,
      requestedBy: session.user.email,
      mode: body.mode ?? "tricycle",
      fare: fareQuote,
    },
    { status: 200 }
  );
}
