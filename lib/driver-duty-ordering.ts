export const INITIAL_DUTY_REVISION = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function dutyRevision(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}
export function parseDutyOrdering(body: any): { ordered: boolean; expected: string | null; invalid: boolean } {
  const present = body?.duty_ordering_v1 !== undefined || body?.duty_expected_revision !== undefined;
  if (!present) return { ordered: false, expected: null, invalid: false };
  const expected = dutyRevision(body?.duty_expected_revision);
  return { ordered: true, expected, invalid: body?.duty_ordering_v1 !== true || expected === null };
}

// The database rotates duty_revision on every write. Compare and write in one
// statement so a request that survives a timeout cannot restore an older duty.
export async function persistDriverDuty(admin: any, payload: any, expected: string) {
  const table = admin.from("driver_locations");
  const write = expected === INITIAL_DUTY_REVISION
    ? table.insert(payload)
    : table.update(payload).eq("driver_id", payload.driver_id).eq("duty_revision", expected);
  const result = await write.select("driver_id,status,duty_revision").maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data)) {
    return { data: null, error: null, conflict: true };
  }
  return { data: result.data, error: result.error, conflict: false };
}
