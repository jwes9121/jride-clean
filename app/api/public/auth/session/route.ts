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

    const meta = (user.user_metadata ?? {}) as any;

    const fullName =
      meta.full_name ??
      meta.name ??
      meta.display_name ??
      null;

    const role = meta.role ?? null;

    return NextResponse.json(
      {
        ok: true,
        authed: true,
        role,
        user: {
          id: user.id,
          email: user.email ?? null,
          phone: (user as any).phone ?? null,
          name: fullName,
          full_name: fullName
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