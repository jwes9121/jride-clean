export const runtime = "nodejs";
import { NextResponse } from "next/server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY || ""; // service_role for server-side REST (bypasses RLS)

function authHeaders() {
  return { apikey: SRK, Authorization: `Bearer ${SRK}` };
}

async function fetchTable(table: string) {
  // Prefer newest first; keep payload small-ish but useful for history.
  const url =
    `${URL}/rest/v1/${table}` +
    `?select=*` +
    `&order=created_at.desc` +
    `&limit=200`;

  const res = await fetch(url, {
    headers: authHeaders(),
    cache: "no-store",
  });

  const txt = await res.text();
  return { ok: res.ok, status: res.status, txt, table };
}

export async function GET() {
  if (!URL || !SRK) {
    return NextResponse.json(
      { status: "error", message: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  // Try tables in a safe order (do NOT assume rides exists).
  const candidates = ["bookings", "rides"];

  let lastErr: any = null;

  for (const table of candidates) {
    const r = await fetchTable(table);

    if (r.ok) {
      try {
        const data = JSON.parse(r.txt);
        // Keep old shape + include table for debugging.
        return NextResponse.json({ status: "ok", table, data });
      } catch {
        return NextResponse.json({ status: "ok", table, raw: r.txt });
      }
    }

    // If it's "table not found", try next. Otherwise return the error.
    const isTableMissing =
      r.txt.includes("PGRST205") ||
      r.txt.includes("Could not find the table") ||
      r.txt.toLowerCase().includes("schema cache");

    lastErr = r;

    if (!isTableMissing) {
      return NextResponse.json(
        { status: "error", table, http_status: r.status, body: r.txt },
        { status: 500 }
      );
    }
  }

  // All candidates failed
  return NextResponse.json(
    {
      status: "error",
      message: "No suitable rides table found (tried: bookings, rides).",
      last: lastErr ? { table: lastErr.table, http_status: lastErr.status, body: lastErr.txt } : null,
    },
    { status: 500 }
  );
}