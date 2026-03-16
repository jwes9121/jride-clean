import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const h = req.headers;

  const proto = h.get("x-forwarded-proto") || "https";
  const xfh = h.get("x-forwarded-host");
  const host = h.get("host") || "";
  const baseUrl = `${proto}://${xfh || host}`;

  return NextResponse.json({
    ok: true,
    observed: {
      url: req.url,
      proto_from_header: h.get("x-forwarded-proto"),
      x_forwarded_host: xfh,
      host: host,
      computed_base_url: baseUrl,
      user_agent: h.get("user-agent"),
      x_forwarded_for: h.get("x-forwarded-for"),
      x_real_ip: h.get("x-real-ip"),
      vercel_url_env: process.env.VERCEL_URL || null,
      nextauth_url_env: process.env.NEXTAUTH_URL || null
    }
  });
}