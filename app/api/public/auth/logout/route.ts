import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function clearAllCookies(req: NextRequest, res: NextResponse) {
  const all = req.cookies.getAll();
  for (const c of all) {
    try {
      res.cookies.set({
        name: c.name,
        value: "",
        path: "/",
        expires: new Date(0),
      });
    } catch {}
  }
  for (const c of all) {
    try {
      res.cookies.set({
        name: c.name,
        value: "",
        path: "/api",
        expires: new Date(0),
      });
    } catch {}
  }
}

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearAllCookies(req, res);
  return res;
}

export async function GET(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearAllCookies(req, res);
  return res;
}