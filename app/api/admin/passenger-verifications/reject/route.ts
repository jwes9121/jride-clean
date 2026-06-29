import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function forbid() {
  return NextResponse.json(
    { ok: false, error: "Forbidden" },
    { status: 403 }
  );
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const role = (session?.user as any)?.role ?? "user";

    if (role !== "admin" && role !== "dispatcher") {
      return forbid();
    }

    const body = await req.json().catch(() => ({}));

    const id = body?.id ? String(body.id) : null;
    const user_id = body?.user_id ? String(body.user_id) : null;
    const reject_reason =
      body?.reject_reason != null ? String(body.reject_reason) : "";

    if (!id && !user_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing id or user_id",
        },
        {
          status: 400,
        }
      );
    }

    const sb = supabaseAdmin();

    let q = sb
      .from("passenger_verifications")
      .update({
        status: "rejected",
        reject_reason,
      })
      .select("*");

    q = id ? q.eq("id", id) : q.eq("user_id", user_id as string);

    const { data, error } = await q;

    if (error) {
      console.error("[reject]", error);
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        row: Array.isArray(data) ? data[0] : data,
      },
      {
        status: 200,
      }
    );
  } catch (e: any) {
    console.error("[reject]", e);

    return NextResponse.json(
      {
        ok: false,
        error: String(e?.message || e),
      },
      {
        status: 500,
      }
    );
  }
}