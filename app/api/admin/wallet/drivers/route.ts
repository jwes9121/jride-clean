import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function csvSet(v: string | undefined | null) {
  return new Set(
    String(v || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function shortId(id: string) {
  const s = String(id || "");
  return s.length > 12 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();

    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";
    const SUPABASE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "";

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.json(
        { ok: false, code: "MISSING_SUPABASE_ENV", message: "Missing SUPABASE_URL / SUPABASE_*_KEY env vars." },
        { status: 500 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const testIds = csvSet(process.env.JRIDE_TEST_DRIVER_IDS);
    const patterns = Array.from(
      csvSet(process.env.JRIDE_TEST_DRIVER_NAME_PATTERNS || "test,dev,sample,dummy")
    ).map((s) => s.toLowerCase());

    async function trySelect(selectStr: string) {
      const res = await supabase
        .from("drivers")
        .select(selectStr)
        .limit(500);
      return res;
    }

    // Try a few likely schemas (do NOT assume columns exist)
    const attempts = [
      "id, full_name, town",
      "id, full_name, municipality",
      "id, name, town",
      "id, name, municipality",
      "id, display_name, town",
      "id, display_name, municipality",
      "id"
    ];

    let rows: any[] = [];
    let lastErr: any = null;

    for (const sel of attempts) {
      // eslint-disable-next-line no-await-in-loop
      const r = await trySelect(sel);
      if (!r.error) {
        rows = Array.isArray(r.data) ? r.data : [];
        lastErr = null;
        break;
      }
      lastErr = r.error;
    }

    if (lastErr) {
      return NextResponse.json(
        { ok: false, code: "DRIVERS_SELECT_FAILED", error: String(lastErr?.message || lastErr) },
        { status: 500 }
      );
    }

    const out = rows
      .map((d: any) => {
        const id = String(d?.id || "");
        const name =
          (d?.full_name ?? d?.name ?? d?.display_name ?? "").toString().trim();
        const town =
          (d?.town ?? d?.municipality ?? d?.city ?? "").toString().trim();

        const label =
          (name ? name : shortId(id)) +
          (town ? ` â€” ${town}` : "") +
          ` (${id})`;

        const nameLower = name.toLowerCase();
        const townLower = town.toLowerCase();
        const isTest =
          (id && testIds.has(id)) ||
          patterns.some((p) => (p && (nameLower.includes(p) || townLower.includes(p))));

        return { id, name, town, label, is_test: isTest };
      })
      .filter((d) => d.id);

    // Optional query filter for client-side typeahead
    const filtered = q
      ? out.filter((d) => String(d.label).toLowerCase().includes(q))
      : out;

    // Always hide test drivers by default
    const cleaned = filtered.filter((d) => !d.is_test);

    // Nice sorting: town then name then id
    cleaned.sort((a, b) => {
      const at = (a.town || "").toLowerCase();
      const bt = (b.town || "").toLowerCase();
      if (at !== bt) return at.localeCompare(bt);
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an !== bn) return an.localeCompare(bn);
      return String(a.id).localeCompare(String(b.id));
    });

    return NextResponse.json({ ok: true, drivers: cleaned });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "UNHANDLED", error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
