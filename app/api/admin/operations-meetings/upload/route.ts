import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MEETING_ALLOWED_MIME_TYPES, MEETING_BUCKET } from "@/lib/operations-meetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 12;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function extensionFor(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "application/pdf") return "pdf";
  return "";
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return json({ error: "Invalid request origin." }, 403);

  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);
  if (access.staff.role !== "admin") return json({ error: "Only Admin can upload meeting presentations." }, 403);

  try {
    const form = await request.formData();
    const meetingId = String(form.get("meetingId") || "").trim();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);

    if (!meetingId) return json({ error: "Meeting ID is required." }, 400);
    if (!files.length) return json({ error: "Choose at least one presentation file." }, 422);
    if (files.length > MAX_FILES_PER_REQUEST) {
      return json({ error: `Upload at most ${MAX_FILES_PER_REQUEST} files at a time.` }, 413);
    }

    const db = supabaseAdmin();
    const meeting = await db.from("operations_meetings").select("id,status").eq("id", meetingId).maybeSingle();
    if (meeting.error || !meeting.data) return json({ error: "Meeting not found." }, 404);
    if (["ended", "cancelled"].includes(meeting.data.status)) return json({ error: "This meeting is already closed." }, 422);

    const lastAsset = await db
      .from("operations_meeting_assets")
      .select("sort_order")
      .eq("meeting_id", meetingId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastAsset.error) return json({ error: "Presentation order could not be loaded." }, 503);

    let nextOrder = Number(lastAsset.data?.sort_order ?? -1) + 1;
    const uploaded: any[] = [];

    for (const file of files) {
      if (!MEETING_ALLOWED_MIME_TYPES.includes(file.type as any)) {
        return json({ error: `Unsupported file type: ${file.type || file.name}` }, 415);
      }
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
        return json({ error: `${file.name} must be 10 MB or smaller.` }, 413);
      }

      const extension = extensionFor(file.type);
      const storagePath = `${meetingId}/${crypto.randomUUID()}.${extension}`;
      const content = Buffer.from(await file.arrayBuffer());
      const upload = await db.storage.from(MEETING_BUCKET).upload(storagePath, content, {
        contentType: file.type,
        upsert: false,
        cacheControl: "3600",
      });
      if (upload.error) return json({ error: `${file.name} could not be uploaded.` }, 503);

      const row = await db
        .from("operations_meeting_assets")
        .insert({
          meeting_id: meetingId,
          kind: file.type === "application/pdf" ? "pdf" : "image",
          storage_path: storagePath,
          mime_type: file.type,
          original_name: file.name.slice(0, 180),
          caption: "",
          sort_order: nextOrder,
        })
        .select("*")
        .single();

      if (row.error || !row.data) {
        await db.storage.from(MEETING_BUCKET).remove([storagePath]);
        return json({ error: `${file.name} uploaded but could not be added to the deck.` }, 503);
      }

      uploaded.push(row.data);
      nextOrder += 1;
    }

    return json({ ok: true, uploaded });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Presentation upload failed." }, 400);
  }
}
