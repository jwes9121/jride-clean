import { NextResponse } from "next/server";
import {
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

export async function POST() {
  const response = NextResponse.json({
    ok: true,
  });

  clearVendorSessionCookie(response);

  return response;
}