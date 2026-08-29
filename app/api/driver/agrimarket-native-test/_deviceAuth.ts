import { supabaseAdmin } from "@/lib/supabaseAdmin";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function basePreviewTestRequest(req: Request): boolean {
  if (text(process.env.VERCEL_ENV).toLowerCase() !== "preview") return false;
  if (text(req.headers.get("x-jride-agrimarket-native-test")) !== "1") return false;
  // The debug app must still prove it carries the Driver secret header. Preview
  // does not currently have the server copy, so the state-changing test routes
  // additionally bind the request to the registered driver/device lock below.
  if (!text(req.headers.get("x-jride-driver-secret"))) return false;
  return true;
}

export function nativeTestStatusAuthorized(req: Request): boolean {
  return basePreviewTestRequest(req);
}

export async function nativeTestDriverDeviceAuthorized(
  req: Request,
  driverId: string
): Promise<boolean> {
  const cleanDriverId = text(driverId);
  const deviceId = text(req.headers.get("x-jride-device-id"));
  if (!basePreviewTestRequest(req) || !cleanDriverId || !deviceId) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanDriverId)) {
    return false;
  }

  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const admin = supabaseAdmin();
  const lock = await admin
    .from("driver_device_locks")
    .select("driver_id,device_id,last_seen")
    .eq("driver_id", cleanDriverId)
    .eq("device_id", deviceId)
    .gte("last_seen", cutoff)
    .limit(1)
    .maybeSingle();

  return !lock.error && !!lock.data;
}
