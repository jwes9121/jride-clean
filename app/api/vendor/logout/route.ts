import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  verifyVendorSession,
  VENDOR_SESSION_COOKIE,
  vendorSessionCookieOptions,
} from "@/lib/vendorSession";

export const dynamic = "force-dynamic";

function clearVendorSessionCookie(response: NextResponse) {
  response.cookies.set(VENDOR_SESSION_COOKIE, "", {
    ...vendorSessionCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(VENDOR_SESSION_COOKIE)?.value;
  if (token && verifyVendorSession(token)) {
    try {
      await supabaseAdmin().from("vendor_native_devices").delete()
        .eq("session_hash", createHash("sha256").update(token).digest("hex"));
    } catch { /* Always clear the browser cookie; native logout also revokes its device. */ }
  }
  const response = NextResponse.json({
    ok: true,
  });

  clearVendorSessionCookie(response);

  return response;
}
