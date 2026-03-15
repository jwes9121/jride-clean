import { NextResponse } from "next/server";
import { acceptOffer, rejectOrExpireOffer } from "@/lib/dispatchOfferQueue";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  action?: string | null;
  responseSource?: string | null;
  autoAdvance?: boolean | null;
  timeoutSeconds?: number | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const action = String(body.action || "accept").trim().toLowerCase();

    if (action === "accept") {
      const result = await acceptOffer({
        bookingId: body.bookingId ?? null,
        bookingCode: body.bookingCode ?? null,
        driverId: body.driverId ?? null,
        responseSource: body.responseSource ?? "driver"
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }

    if (action === "reject" || action === "rejected" || action === "expire" || action === "expired") {
      const normalized = action.startsWith("exp") ? "expired" : "rejected";
      const result = await rejectOrExpireOffer({
        bookingId: body.bookingId ?? null,
        bookingCode: body.bookingCode ?? null,
        driverId: body.driverId ?? null,
        action: normalized,
        responseSource: body.responseSource ?? "driver",
        autoAdvance: body.autoAdvance !== false,
        timeoutSeconds: Number(body.timeoutSeconds || 8)
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_ACTION",
        message: "Use accept, reject, or expire"
      },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("DISPATCH_OFFER_RESPOND_UNEXPECTED", err);
    return NextResponse.json(
      {
        ok: false,
        error: "DISPATCH_OFFER_RESPOND_UNEXPECTED",
        message: err?.message ?? "Unexpected error"
      },
      { status: 500 }
    );
  }
}