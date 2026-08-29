import { nativeDriverTestAuthorized, nativeTestJson } from "@/app/api/driver/agrimarket-native-test/_lib";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: Request) {
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
