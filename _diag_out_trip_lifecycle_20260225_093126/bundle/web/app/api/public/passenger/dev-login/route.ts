import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  // DEV ONLY: require explicit env flag
  const devEnabled = process.env.JRIDE_DEV_PASSENGER_LOGIN === "1";
  if (!devEnabled) {
    return NextResponse.json({ ok: false, error: "DEV_LOGIN_DISABLED" }, { status: 404 });
  }

  const email = process.env.JRIDE_DEV_PASSENGER_EMAIL || "";
  const password = process.env.JRIDE_DEV_PASSENGER_PASSWORD || "";
  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "MISSING_DEV_CREDENTIALS", need: ["JRIDE_DEV_PASSENGER_EMAIL", "JRIDE_DEV_PASSENGER_PASSWORD"] },
      { status: 500 }
    );
  }

  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ ok: false, error: "SIGNIN_FAILED", details: error.message }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    user_id: data.user?.id ?? null,
    email: data.user?.email ?? null,
    note: "Supabase session cookie should now be set for this browser.",
  });
}
