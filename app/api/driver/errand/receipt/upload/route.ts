import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  errandFeatureEnabled,
  loadErrandBundleByBookingId,
} from "@/lib/errand/server";

export const runtime = "nodejs";

const RECEIPT_BUCKET = "errand-receipts";
const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const ALLOWED_INPUT_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export async function POST(req: Request) {
  try {
    if (!errandFeatureEnabled()) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_BOOKING_NOT_ENABLED" },
        { status: 503, headers: noStoreHeaders() }
      );
    }

    const form = await req.formData();
    const bookingId = text(form.get("booking_id") || form.get("bookingId"));
    const sequence = positiveInt(form.get("sequence"));
    const explicitDriverId = text(form.get("driver_id") || form.get("driverId"));
    const fileValue = form.get("file");

    if (!bookingId || sequence == null) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_AND_STOP_SEQUENCE_REQUIRED" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (
      !fileValue ||
      typeof fileValue !== "object" ||
      typeof (fileValue as any).arrayBuffer !== "function"
    ) {
      return NextResponse.json(
        { ok: false, error: "RECEIPT_FILE_REQUIRED" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const identity = await resolveDriverRequest(req, explicitDriverId);
    if (!identity.ok || !identity.driverId) {
      return NextResponse.json(
        { ok: false, error: identity.error || "NOT_AUTHED" },
        { status: identity.status || 401, headers: noStoreHeaders() }
      );
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);
    if (!bundle.ok) {
      return NextResponse.json(
        { ok: false, error: bundle.error },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const assignedDriverId = text(
      (bundle.booking as any).assigned_driver_id ||
        (bundle.booking as any).driver_id
    );
    if (assignedDriverId !== identity.driverId) {
      return NextResponse.json(
        { ok: false, error: "DRIVER_NOT_ASSIGNED" },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    if (!(bundle.job as any).is_pabili) {
      return NextResponse.json(
        { ok: false, error: "NOT_PABILI_ERRAND" },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const currentSequence = Number((bundle.job as any).current_stop_sequence);
    const errandStage = text((bundle.job as any).errand_stage).toLowerCase();
    const stop = bundle.stops.find(
      (row: any) => Number(row?.sequence) === sequence
    );

    if (
      currentSequence !== sequence ||
      errandStage !== "waiting_at_stop" ||
      !stop ||
      text((stop as any).status).toLowerCase() !== "arrived"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "RECEIPT_UPLOAD_ONLY_AT_CURRENT_ARRIVED_STOP",
          current_stop_sequence: Number.isFinite(currentSequence)
            ? currentSequence
            : null,
          errand_stage: errandStage || null,
        },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const mime = text((fileValue as any).type).toLowerCase();
    const declaredSize = Number((fileValue as any).size || 0);

    if (!ALLOWED_INPUT_MIME.has(mime)) {
      return NextResponse.json(
        {
          ok: false,
          error: "UNSUPPORTED_RECEIPT_IMAGE_TYPE",
          allowed: Array.from(ALLOWED_INPUT_MIME),
        },
        { status: 415, headers: noStoreHeaders() }
      );
    }

    if (declaredSize > MAX_INPUT_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "RECEIPT_IMAGE_TOO_LARGE",
          max_input_bytes: MAX_INPUT_BYTES,
        },
        { status: 413, headers: noStoreHeaders() }
      );
    }

    const input = Buffer.from(await (fileValue as any).arrayBuffer());
    if (input.length === 0 || input.length > MAX_INPUT_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: input.length === 0
            ? "RECEIPT_IMAGE_EMPTY"
            : "RECEIPT_IMAGE_TOO_LARGE",
          max_input_bytes: MAX_INPUT_BYTES,
        },
        { status: input.length === 0 ? 400 : 413, headers: noStoreHeaders() }
      );
    }

    let output: Buffer;
    try {
      output = await sharp(input)
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();

      if (output.length > MAX_OUTPUT_BYTES) {
        output = await sharp(input)
          .rotate()
          .resize({
            width: 1280,
            height: 1280,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 70 })
          .toBuffer();
      }
    } catch (error: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "RECEIPT_IMAGE_PROCESSING_FAILED",
          message: String(error?.message || error),
        },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (output.length > MAX_OUTPUT_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "RECEIPT_IMAGE_OUTPUT_TOO_LARGE",
          max_output_bytes: MAX_OUTPUT_BYTES,
        },
        { status: 413, headers: noStoreHeaders() }
      );
    }

    const path = `${bookingId}/${sequence}/${Date.now()}-${randomUUID()}.webp`;
    const admin = supabaseAdmin();
    const uploaded = await admin.storage
      .from(RECEIPT_BUCKET)
      .upload(path, output, {
        contentType: "image/webp",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploaded.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "RECEIPT_UPLOAD_FAILED",
          message: uploaded.error.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking_id: bookingId,
        sequence,
        receipt_path: path,
        receipt_photo_url: path,
        content_type: "image/webp",
        original_bytes: input.length,
        stored_bytes: output.length,
        bucket: RECEIPT_BUCKET,
        public: false,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "RECEIPT_UPLOAD_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
