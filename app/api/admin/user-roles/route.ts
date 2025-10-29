import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function forbid() { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

export async function GET() {
  const session = await auth();
  const role = (session?.user as any)?.role ?? "user";
  if (role !== "admin") return forbid();

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("user_roles").select("email, role, updated_at").order("email", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role ?? "user";
  if (role !== "admin") return forbid();

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const newRole = String(body?.role || "").trim().toLowerCase();
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  if (!["admin","dispatcher","user"].includes(newRole)) return NextResponse.json({ error: "role must be admin|dispatcher|user" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("user_roles").upsert({ email, role: newRole }, { onConflict: "email" }).select("email, role, updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role ?? "user";
  if (role !== "admin") return forbid();

  const { searchParams } = new URL(req.url);
  const email = String(searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb.from("user_roles").delete().eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
