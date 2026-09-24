import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { evidenceLocation, PASSENGER_UUID, type EvidenceKind } from "@/lib/passenger/identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer" },
  });
}

export async function POST(req: Request) {
  try {
    const access = await requireStaff(["admin"]);
    if (!access.ok) return json(access.status, { ok: false, error: access.error });
    if (!access.staff.email || req.headers.get("origin") !== new URL(req.url).origin) {
      return json(403, { ok: false, error: "Forbidden" });
    }
    const body = await req.json().catch(() => null);
    const userId = typeof body?.passenger_id === "string" ? body.passenger_id.trim().toLowerCase() : "";
    const kind = body?.kind as EvidenceKind;
    if (!PASSENGER_UUID.test(userId) || !["id_front", "id_back", "selfie"].includes(kind)) {
      return json(400, { ok: false, error: "Invalid passenger or evidence type." });
    }
    const db = supabaseAdmin({ noStore: true });
    const request = await db.from("passenger_verification_requests")
      .select("passenger_id,id_front_path,id_back_path,selfie_with_id_path,updated_at")
      .eq("passenger_id", userId).maybeSingle();
    if (request.error) return json(503, { ok: false, error: "Evidence is unavailable. Please retry." });

    let value: unknown = null;
    let source = "passenger_verification_requests";
    let version: string | null = request.data?.updated_at || null;
    if (request.data) {
      value = kind === "selfie" ? request.data.selfie_with_id_path
        : kind === "id_back" ? request.data.id_back_path : request.data.id_front_path;
    } else {
      source = "passenger_verifications";
      const legacy = await db.from("passenger_verifications")
        .select("id_photo_url,selfie_photo_url,updated_at").eq("user_id", userId).maybeSingle();
      if (legacy.error) return json(503, { ok: false, error: "Evidence is unavailable. Please retry." });
      value = kind === "selfie" ? legacy.data?.selfie_photo_url
        : kind === "id_front" ? legacy.data?.id_photo_url : null;
      version = legacy.data?.updated_at || null;
    }
    if (!value) return json(404, { ok: false, error: "No evidence file is recorded for this selection." });
    const location = evidenceLocation(value, userId, kind, source === "passenger_verifications",
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    if (!location) return json(409, { ok: false, error: "This evidence location requires manual admin review." });

    // Fail closed: never issue an evidence link unless the access is recorded.
    // No image, government ID number, storage path or signed URL enters the audit.
    const audit = await db.from("admin_audit_logs").insert({
      actor: access.staff.email,
      action: "passenger_verification_evidence_access",
      entity_type: "passenger",
      entity_id: userId,
      payload: { actor_id: access.staff.id, role: access.staff.role, kind, source, record_updated_at: version },
    });
    if (audit.error) return json(503, { ok: false, error: "Evidence access could not be audited. Please retry." });
    const signed = await db.storage.from(location.bucket).createSignedUrl(location.path, 60);
    if (signed.error || !signed.data?.signedUrl) {
      return json(503, { ok: false, error: "The evidence file could not be opened. Please retry." });
    }
    return json(200, { ok: true, url: signed.data.signedUrl, expires_in: 60 });
  } catch {
    return json(503, { ok: false, error: "Evidence is unavailable. Please retry." });
  }
}
