// Start with the same latest location roster used by LiveTrips' driver_locations
// endpoint. Also exclude explicit inactive/terminated roster records.
type Location = { driver_id?: string | null; home_town?: string | null };
type Identity = { id: string; driver_name?: string | null; driver_status?: string | null; roster_status?: string | null };
type Profile = { driver_id: string; full_name?: string | null; municipality?: string | null };
// Confirmed coordinator identities and JRide's existing tester IDs. Excluding
// from team distribution does not deactivate these accounts or change access.
const NON_TEAM_DRIVER_IDS = new Set([
  "d41bf199-96c6-4022-8a3d-09ab9dbd270f", // Marcus / Macuswilis B. Pugong
  "5b9c3a17-7c5e-45fd-93ab-1f8f2a6d3c72", // Kong / Agerico L. Ligeralde
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
]);
const TEST_DRIVER_NAME = /\b(?:test|tester|dummy|sample)\s+driver\b|\bdriver\s+(?:test|tester)\b/i;
export function operationsDriverRoster(locations: Location[], identities: Identity[], profiles: Profile[]) {
  const hidden = new Set(["deactivated", "deleted", "removed", "removed_from_pilot", "inactive", "terminated", "pending"]);
  const seen = new Set<string>();
  return locations.flatMap(row => {
    const id = row.driver_id?.trim();
    if (!id || seen.has(id) || NON_TEAM_DRIVER_IDS.has(id)) return [];
    seen.add(id);
    const identity = identities.find(d => d.id === id);
    if (hidden.has(identity?.driver_status?.trim().toLowerCase() || "") || hidden.has(identity?.roster_status?.trim().toLowerCase() || "")) return [];
    const profile = profiles.find(p => p.driver_id === id);
    if (TEST_DRIVER_NAME.test(identity?.driver_name || "") || TEST_DRIVER_NAME.test(profile?.full_name || "")) return [];
    const town = profile?.municipality?.trim() || row.home_town?.trim() || "Unassigned town";
    return [{ id, name: identity?.driver_name || profile?.full_name || "Unnamed driver", town: ["Lagawe", "Hingyon", "Banaue", "Lamut"].find(t => t.toLowerCase() === town.toLowerCase()) || town }];
  });
}
