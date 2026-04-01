import { NextResponse } from "next/server";
import { sendEmail } from "@/utils/email/sendEmail";

export async function GET() {
  try {
    await sendEmail({
      to: "your_test_email@gmail.com",
      subject: "JRide SMTP Test",
      html: "<p>SMTP is working.</p>",
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "EMAIL_TEST_FAILED" },
      { status: 500 }
    );
  }
}