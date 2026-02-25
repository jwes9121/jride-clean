import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  try {
    const supabase = createClient();

    const { data, error } = await supabase.auth.getUser();
    const user = data?.user ?? null;

    const headers = { "Cache-Control": "no-store, max-age=0" };

    if (error || !user) {
      return NextResponse.json(
        { ok: true, authed: false },
        { status: 200, headers }
      );
    }

    const role = (user.user_metadata as any)?.role ?? null;

    return NextResponse.json(
      {
        ok: true,
        authed: true,
        role,
        user: {
          id: user.id,
          email: user.email ?? null,
          phone: (user as any).phone ?? null
        }
      },
      { status: 200, headers }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "SESSION_ROUTE_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}