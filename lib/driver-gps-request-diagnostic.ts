// Temporary, authenticated tester-only logging. Expires at midnight Philippine time.
const TEST_DRIVER_ID = "00000000-0000-4000-8000-000000000002";
const EXPIRES_AT_MS = Date.parse("2026-09-26T16:00:00.000Z");

export function driverGpsRequestDiagnostic(input: {
  driverId: string;
  body: unknown;
  hasCoordinates: boolean;
  accuracyMeters: number | null;
  mockLocation: boolean | null;
  ordered: boolean;
  userAgent: string | null;
  nowMs?: number;
}) {
  const now = input.nowMs ?? Date.now();
  if (input.driverId !== TEST_DRIVER_ID || !Number.isFinite(now) || now >= EXPIRES_AT_MS) {
    return null;
  }
  const body = input.body && typeof input.body === "object"
    ? input.body as Record<string, unknown> : {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const ascii = (value: unknown, max: number) => typeof value === "string"
    ? value.replace(/[^\x20-\x7E]/g, "").slice(0, max) : null;

  return {
    diagnostic_version: "gps_request_shape_v1",
    driver_id: TEST_DRIVER_ID,
    received_at: new Date(now).toISOString(),
    has_coordinates: input.hasCoordinates,
    accuracy_m_present: has("accuracy_m"),
    accuracy_meters: input.accuracyMeters,
    mock_flag_present: has("is_mock_location"),
    mock_location: input.mockLocation,
    duty_ordered: input.ordered,
    client_version_name: ascii(body.client_version_name, 64),
    client_version_code: typeof body.client_version_code === "number" &&
      Number.isSafeInteger(body.client_version_code) ? body.client_version_code : null,
    user_agent: ascii(input.userAgent, 160),
  };
}
