import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { effectiveSchedule, type Schedule } from "@/lib/operations-schedule";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AUDIENCES = new Set(["general", "drivers", "vendors", "agri_vendors"]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function authorizeOrientationNotes(
  db: ReturnType<typeof supabaseAdmin>,
  adminOnly = false
) {
  const access = await requireStaff();
  if (!access.ok) return access;

  if (access.staff.role === "admin") return access;

  if (adminOnly) {
    return {
      ok: false as const,
      status: 403 as const,
      error: "FORBIDDEN",
    };
  }

  const { data, error } = await db
    .from("operations_schedule_state")
    .select("state")
    .eq("id", 1)
    .single();

  if (error || !data) {
    return {
      ok: false as const,
      status: 503 as const,
      error: "OPERATIONS_SCHEDULE_UNAVAILABLE",
    };
  }

  const state = effectiveSchedule(data.state as Schedule);
  const employee = state.employees.find(
    (item) => item.email.trim().toLowerCase() === access.staff.email
  );

  if (!employee) {
    return {
      ok: false as const,
      status: 403 as const,
      error: "FORBIDDEN",
    };
  }

  return access;
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function parseSortOrder(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(9999, Math.round(n)));
}

function normalizePayload(body: any) {
  const title = cleanText(body?.title, 140);
  const content = cleanText(body?.content, 12000);
  const audienceRaw = cleanText(body?.audience, 30).toLowerCase();
  const audience = AUDIENCES.has(audienceRaw) ? audienceRaw : "general";
  const sort_order = parseSortOrder(body?.sort_order);
  const is_active = body?.is_active !== false;

  if (!title) {
    return { ok: false as const, error: "Title is required." };
  }
  if (!content) {
    return { ok: false as const, error: "Cheat sheet notes are required." };
  }

  return {
    ok: true as const,
    value: {
      title,
      content,
      audience,
      sort_order,
      is_active,
    },
  };
}

const SELECT =
  "id,title,audience,content,sort_order,is_active,created_at,updated_at";

export async function GET() {
  try {
    const db = supabaseAdmin();
    const access = await authorizeOrientationNotes(db);

    if (!access.ok) {
      return json({ error: access.error }, access.status);
    }

    let query = db
      .from("operations_orientation_notes")
      .select(SELECT)
      .order("audience", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (access.staff.role !== "admin") {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (error) {
      return json(
        { error: "Orientation notes could not be loaded.", detail: error.message },
        503
      );
    }

    return json({
      ok: true,
      admin: access.staff.role === "admin",
      notes: data || [],
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Orientation notes could not be loaded.",
      },
      503
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = supabaseAdmin();
    const access = await authorizeOrientationNotes(db, true);

    if (!access.ok) {
      return json({ error: access.error }, access.status);
    }

    const body = await req.json().catch(() => ({}));
    const normalized = normalizePayload(body);
    if (!normalized.ok) {
      return json({ error: normalized.error }, 400);
    }

    const now = new Date().toISOString();
    const { data, error } = await db
      .from("operations_orientation_notes")
      .insert({
        ...normalized.value,
        created_by: access.staff.email,
        updated_by: access.staff.email,
        created_at: now,
        updated_at: now,
      })
      .select(SELECT)
      .single();

    if (error) {
      return json(
        { error: "Orientation note could not be added.", detail: error.message },
        500
      );
    }

    return json({ ok: true, note: data }, 201);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Orientation note could not be added.",
      },
      500
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = supabaseAdmin();
    const access = await authorizeOrientationNotes(db, true);

    if (!access.ok) {
      return json({ error: access.error }, access.status);
    }

    const body = await req.json().catch(() => ({}));
    const id = cleanText(body?.id, 80);
    if (!id) return json({ error: "Orientation note id is required." }, 400);

    const normalized = normalizePayload(body);
    if (!normalized.ok) {
      return json({ error: normalized.error }, 400);
    }

    const { data, error } = await db
      .from("operations_orientation_notes")
      .update({
        ...normalized.value,
        updated_by: access.staff.email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();

    if (error) {
      return json(
        { error: "Orientation note could not be updated.", detail: error.message },
        500
      );
    }
    if (!data) {
      return json({ error: "Orientation note not found." }, 404);
    }

    return json({ ok: true, note: data });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Orientation note could not be updated.",
      },
      500
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = supabaseAdmin();
    const access = await authorizeOrientationNotes(db, true);

    if (!access.ok) {
      return json({ error: access.error }, access.status);
    }

    const body = await req.json().catch(() => ({}));
    const id = cleanText(body?.id, 80);
    if (!id) return json({ error: "Orientation note id is required." }, 400);

    const { data, error } = await db
      .from("operations_orientation_notes")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      return json(
        { error: "Orientation note could not be deleted.", detail: error.message },
        500
      );
    }
    if (!data) {
      return json({ error: "Orientation note not found." }, 404);
    }

    return json({ ok: true, id: data.id });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Orientation note could not be deleted.",
      },
      500
    );
  }
}
