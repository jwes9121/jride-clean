import { NextResponse } from "next/server";
import { createNextOffer } from "@/lib/dispatchOfferQueue";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  timeoutSeconds?: number | null;
  source?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const result = await createNextOffer({
      bookingId: body.bookingId ?? null,
      bookingCode: body.bookingCode ?? null,
      timeoutSeconds: Number(body.timeoutSeconds || 8),
      source: body.source ?? "api"
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err: any) {
    console.error("DISPATCH_OFFER_UNEXPECTED", err);
    return NextResponse.json(
      {
        ok: false,
        error: "DISPATCH_OFFER_UNEXPECTED",
        message: err?.message ?? "Unexpected error"
      },
      { status: 500 }
    );
  }
}