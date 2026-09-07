// Start with the same latest location roster used by LiveTrips' driver_locations
// endpoint. Also exclude explicit inactive/terminated roster records.
type Location = { driver_id?: string | null; home_town?: string | null };
type Identity = { id: string; driver_name?: string | null; driver_status?: string | null; roster_status?: string | null };
type Profile = { driver_id: string; full_name?: string | null; municipality?: string | null };
export function operationsDriverRoster(locations: Location[], identities: Identity[], profiles: Profile[]) {
  const hidden = new Set(["deactivated", "deleted", "removed", "removed_from_pilot", "inactive", "terminated"]);
  const seen = new Set<string>();
  return locations.flatMap(row => {
    const id = row.driver_id?.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const identity = identities.find(d => d.id === id);
    if (hidden.has(identity?.driver_status?.trim().toLowerCase() || "") || hidden.has(identity?.roster_status?.trim().toLowerCase() || "")) return [];
    const profile = profiles.find(p => p.driver_id === id);
    const town = profile?.municipality?.trim() || row.home_town?.trim() || "Unassigned town";
    return [{ id, name: identity?.driver_name || profile?.full_name || "Unnamed driver", town: ["Lagawe", "Hingyon", "Banaue", "Lamut"].find(t => t.toLowerCase() === town.toLowerCase()) || town }];
  });
}
