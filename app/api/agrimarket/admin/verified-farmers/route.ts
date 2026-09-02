import { randomInt } from "crypto";
import { NextRequest } from "next/server";
import {
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketStaff,
} from "../../_lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const IFUGAO_TOWNS = new Map([
  ["aguinaldo", "Aguinaldo"],
  ["alfonso lista", "Alfonso Lista"],
  ["asipulo", "Asipulo"],
  ["banaue", "Banaue"],
  ["hingyon", "Hingyon"],
  ["hungduan", "Hungduan"],
  ["kiangan", "Kiangan"],
  ["lagawe", "Lagawe"],
  ["lamut", "Lamut"],
  ["mayoyao", "Mayoyao"],
  ["tinoc", "Tinoc"],
]);

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function optionalText(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}

function canonicalTown(value: unknown): string | null {
  return IFUGAO_TOWNS.get(text(value).toLowerCase()) || null;
}

function normalizePhone(value: unknown): string {
  let digits = text(value).replace(/[^0-9]/g, "");
  if (/^63[0-9]{10}$/.test(digits)) digits = `0${digits.slice(2)}`;
  if (/^9[0-9]{9}$/.test(digits)) digits = `0${digits}`;
  return digits;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || text(value) === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intendedProducts(value: unknown): string[] {
  const values = Array.isArray(value) ? value : text(value).split(",");
  return Array.from(
    new Set(values.map((item) => text(item)).filter(Boolean))
  ).slice(0, 30);
}

function generateAccessCode(): string {
  let suffix = "";
  for (let index = 0; index < 8; index += 1) {
    suffix += ACCESS_CODE_ALPHABET[randomInt(0, ACCESS_CODE_ALPHABET.length)];
  }
  return `AGF-${suffix}`;
}

function generateTemporaryPin(): string {
  return String(randomInt(100000, 1000000));
}

async function generateUniqueAccessCode(service: ReturnType<typeof createServiceSupabase>): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateAccessCode();
    const { data, error } = await service
      .from("agrimarket_producer_credentials")
      .select("id")
      .eq("access_code", candidate)
      .maybeSingle();

    if (error) throw new Error(error.message || "AGRIMARKET_ACCESS_CODE_CHECK_FAILED");
    if (!data) return candidate;
  }
  throw new Error("AGRIMARKET_ACCESS_CODE_GENERATION_FAILED");
}

function failureStatus(message: string): number {
  const upper = message.toUpperCase();
  if (
    upper.includes("ALREADY_REGISTERED") ||
    upper.includes("OPEN_APPLICATION_EXISTS") ||
    upper.includes("ACCESS_CODE_ALREADY_EXISTS") ||
    upper.includes("DUPLICATE KEY")
  ) return 409;
  if (upper.includes("INVALID") || upper.includes("REQUIRED")) return 400;
  return 500;
}

export async function GET() {
  const staff = await requireAgrimarketStaff(false);
  if (!staff.ok) return staff.response;

  try {
    const service = createServiceSupabase();
    const { data: events, error: eventError } = await service
      .from("agrimarket_producer_access_events")
      .select("producer_id,actor,reason,details,created_at")
      .eq("event_type", "farmer_provisioned")
      .order("created_at", { ascending: false })
      .limit(500);

    if (eventError) throw new Error(eventError.message || "AGRIMARKET_VERIFIED_FARMERS_LOAD_FAILED");

    const latestEventByProducer = new Map<string, any>();
    for (const event of events || []) {
      const producerId = text(event?.producer_id);
      if (producerId && !latestEventByProducer.has(producerId)) {
        latestEventByProducer.set(producerId, event);
      }
    }

    const producerIds = Array.from(latestEventByProducer.keys());
    if (!producerIds.length) {
      return jsonNoStore({ ok: true, staff_role: staff.role, farmers: [] });
    }

    const [{ data: producers, error: producerError }, { data: credentials, error: credentialError }] = await Promise.all([
      service
        .from("agrimarket_producers")
        .select("id,contact_name,contact_phone,town,barangay,pickup_label,pickup_lat,pickup_lng,status,accepting_orders,created_at,updated_at")
        .in("id", producerIds),
      service
        .from("agrimarket_producer_credentials")
        .select("producer_id,access_code,status,failed_attempts,locked_until,last_used_at,created_by,created_at,updated_at")
        .in("producer_id", producerIds),
    ]);

    if (producerError) throw new Error(producerError.message || "AGRIMARKET_VERIFIED_FARMERS_LOAD_FAILED");
    if (credentialError) throw new Error(credentialError.message || "AGRIMARKET_VERIFIED_FARMER_CREDENTIALS_LOAD_FAILED");

    const credentialByProducer = new Map((credentials || []).map((row: any) => [String(row.producer_id), row]));
    const farmers = (producers || []).map((producer: any) => {
      const event = latestEventByProducer.get(String(producer.id));
      const details = (event?.details && typeof event.details === "object" ? event.details : {}) as JsonRecord;
      const credential = credentialByProducer.get(String(producer.id)) as any;
      return {
        producer_id: producer.id,
        contact_name: producer.contact_name,
        contact_phone: producer.contact_phone,
        town: producer.town,
        barangay: producer.barangay,
        private_pickup_label: producer.pickup_label,
        private_pickup_lat: producer.pickup_lat,
        private_pickup_lng: producer.pickup_lng,
        producer_status: producer.status,
        accepting_orders: producer.accepting_orders,
        access_code: credential?.access_code || null,
        credential_status: credential?.status || null,
        credential_failed_attempts: Number(credential?.failed_attempts || 0),
        credential_locked_until: credential?.locked_until || null,
        credential_last_used_at: credential?.last_used_at || null,
        provisioned_by: event?.actor || credential?.created_by || null,
        verification_note: event?.reason || null,
        provisioned_at: event?.created_at || credential?.created_at || producer.created_at,
        intended_products: Array.isArray(details.intended_products) ? details.intended_products : [],
        identity_type: optionalText(details.identity_type),
        identity_reference_last4: optionalText(details.identity_reference_last4),
      };
    }).sort((a: any, b: any) => String(b.provisioned_at).localeCompare(String(a.provisioned_at)));

    return jsonNoStore({ ok: true, staff_role: staff.role, farmers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AGRIMARKET_VERIFIED_FARMERS_LOAD_FAILED";
    return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMERS_LOAD_FAILED", message }, 500);
  }
}

export async function POST(request: NextRequest) {
  const staff = await requireAgrimarketStaff(true);
  if (!staff.ok) return staff.response;

  try {
    const body = await request.json().catch(() => ({}));
    const contactName = text(body?.contact_name);
    const contactPhone = normalizePhone(body?.contact_phone);
    const town = canonicalTown(body?.town);
    const barangay = optionalText(body?.barangay);
    const pickupLabel = text(body?.pickup_label);
    const pickupLat = numberValue(body?.pickup_lat);
    const pickupLng = numberValue(body?.pickup_lng);
    const products = intendedProducts(body?.intended_products);
    const identityType = optionalText(body?.identity_type);
    const identityLast4 = optionalText(body?.identity_reference_last4)?.toUpperCase() || null;
    const verificationNote = text(body?.verification_note);

    if (contactName.length < 2 || contactName.length > 160) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_NAME_INVALID" }, 400);
    }
    if (!/^[0-9]{10,16}$/.test(contactPhone)) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID" }, 400);
    }
    if (!town) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_TOWN_INVALID" }, 400);
    }
    if (pickupLabel.length < 2 || pickupLabel.length > 500) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PICKUP_LABEL_INVALID" }, 400);
    }
    if (pickupLat === null || pickupLat < -90 || pickupLat > 90) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PICKUP_LAT_INVALID" }, 400);
    }
    if (pickupLng === null || pickupLng < -180 || pickupLng > 180) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PICKUP_LNG_INVALID" }, 400);
    }
    if (products.some((product) => product.length > 120)) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PRODUCTS_INVALID" }, 400);
    }
    if (identityType && identityType.length > 120) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_IDENTITY_TYPE_INVALID" }, 400);
    }
    if (identityLast4 && !/^[A-Z0-9]{2,4}$/.test(identityLast4)) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_IDENTITY_LAST4_INVALID" }, 400);
    }
    if (identityLast4 && !identityType) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_IDENTITY_TYPE_REQUIRED" }, 400);
    }
    if (verificationNote.length < 5 || verificationNote.length > 1000) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_VERIFICATION_NOTE_REQUIRED" }, 400);
    }

    const service = createServiceSupabase();
    const accessCode = await generateUniqueAccessCode(service);
    const temporaryPin = generateTemporaryPin();
    const now = new Date().toISOString();

    const { data, error } = await service.rpc("agrimarket_admin_provision_verified_farmer_v1", {
      p_contact_name: contactName,
      p_contact_phone: contactPhone,
      p_town: town,
      p_barangay: barangay,
      p_pickup_label: pickupLabel,
      p_pickup_lat: pickupLat,
      p_pickup_lng: pickupLng,
      p_intended_products: products,
      p_identity_type: identityType,
      p_identity_reference_last4: identityLast4,
      p_verification_note: verificationNote,
      p_access_code: accessCode,
      p_pin: temporaryPin,
      p_provisioned_by: staff.actor,
      p_now: now,
    });

    if (error) {
      const message = error.message || "AGRIMARKET_VERIFIED_FARMER_PROVISION_FAILED";
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PROVISION_FAILED", message }, failureStatus(message));
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.producer_id) {
      return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PROVISION_FAILED" }, 500);
    }

    return jsonNoStore({
      ok: true,
      farmer: {
        producer_id: result.producer_id,
        contact_name: contactName,
        contact_phone: contactPhone,
        town,
        barangay,
        producer_status: result.producer_status,
        accepting_orders: Boolean(result.accepting_orders),
        provisioned_at: result.provisioned_at,
      },
      credential: {
        access_code: result.access_code || accessCode,
        temporary_pin: temporaryPin,
        farmer_login_path: "/agrimarket/farmer",
        pin_visible_once: true,
      },
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AGRIMARKET_VERIFIED_FARMER_PROVISION_FAILED";
    return jsonNoStore({ ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PROVISION_FAILED", message }, failureStatus(message));
  }
}
