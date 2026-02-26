import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) {
      return NextResponse.json(
        { ok: false, reason: "missing_env", needs: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] },
        { status: 200 }
      );
    }

    const cookieStore = cookies();

    const supabase = createServerClient(url, anon, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          // Route handlers can set cookies; keep for completeness
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    });

    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user?.id) {
      // Debug: cookie names only (no values)
      const hdr = cookieStore.toString ? cookieStore.toString() : null;
      return NextResponse.json(
        {
          ok: false,
          reason: "no_supabase_user",
          debug: {
            cookieNames: cookieNames(hdr),
            hasSbCookies: cookieNames(hdr).some((n) => n.startsWith("sb-") && n.includes("-auth-token")),
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true, user_id: data.user.id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, reason: "exception", message: String(e?.message || e) },
      { status: 200 }
    );
  }
}