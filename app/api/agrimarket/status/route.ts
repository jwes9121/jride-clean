import { agrimarketEnabled, agrimarketOnboardingEnabled, jsonNoStore } from "../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  return jsonNoStore(200, {
    ok: true,
    enabled: agrimarketEnabled(),
    onboarding_enabled: agrimarketOnboardingEnabled(),
  });
}
