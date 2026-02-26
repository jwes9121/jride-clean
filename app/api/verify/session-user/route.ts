import { NextResponse } from "next/server";
import { auth } from "../../../../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cookieNames(cookieHeader: string | null) {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split("=")[0])
    .slice(0, 50);
}

// NextAuth v5 wrapper form
export const GET = auth(async (req) => {
  try {
    const cookieHeader = req.headers.get("cookie");
    const names = cookieNames(cookieHeader);

    const a: any = (req as any).auth;
    const email = a?.user?.email ?? null;
    const name = a?.user?.name ?? null;
    const userId = a?.user?.id ?? null;

    // This debug is safe (no cookie values)
    if (!email && !userId) {
      return NextResponse.json(
        {
          ok: false,
          reason: "no_session_identity",
          debug: {
            hasAuth: !!a,
            authKeys: a ? Object.keys(a) : [],
            userKeys: a?.user ? Object.keys(a.user) : [],
            cookieHeaderPresent: !!cookieHeader,
            cookieNames: names,
          },
        },
        { status: 200 }
      );
    }

    // For now just prove we can see identity
    return NextResponse.json(
      {
        ok: true,
        identity: {
          email,
          namePresent: !!name,
          userIdPresent: !!userId,
        },
        debug: {
          cookieHeaderPresent: !!cookieHeader,
          cookieNames: names,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, reason: "exception", message: String(e?.message || e) },
      { status: 200 }
    );
  }
});