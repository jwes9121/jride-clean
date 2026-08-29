import { nativeDriverTestAuthorized, nativeTestJson } from "@/app/api/driver/agrimarket-native-test/_lib";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: Request) {
  const vercelPreview = String(process.env.VERCEL_ENV || "").trim().toLowerCase() === "preview";
  const nativeHeader = String(req.headers.get("x-jride-agrimarket-native-test") || "").trim() === "1";
  const suppliedSecret = String(req.headers.get("x-jride-driver-secret") || "").trim();
  const expectedSecret = String(process.env.DRIVER_PING_SECRET || "").trim();
  const secretPresent = suppliedSecret.length > 0;
  const expectedSecretPresent = expectedSecret.length > 0;
  const secretMatch = secretPresent && expectedSecretPresent && suppliedSecret === expectedSecret;

  console.info("AGRIMARKET_NATIVE_TEST_GATE", {
    vercelPreview,
    nativeHeader,
    secretPresent,
    expectedSecretPresent,
    secretMatch,
  });

  if (!nativeDriverTestAuthorized(req)) {
    return nativeTestJson(404, { ok: false, enabled: false, error: "NATIVE_TEST_NOT_AVAILABLE" });
  }

  return nativeTestJson(200, {
    ok: true,
    enabled: true,
    native_driver_test: true,
    real_agrimarket_enabled: false,
    money_mode: "zero_only",
  });
}
