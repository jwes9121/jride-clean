function clean(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function key(value: unknown): string {
  return clean(value).toLowerCase();
}

const GENERIC_DIRECTIONS = new Set([
  "n/a",
  "na",
  "none",
  "same",
  "same place",
  "same as store",
  "same as farm",
  "home",
  "house",
  "farm",
  "store",
]);

export function driverDirectionsError(input: {
  directions: unknown;
  contactName?: unknown;
  vendorName?: unknown;
  town?: unknown;
  barangay?: unknown;
}): string | null {
  const directions = clean(input.directions);
  const normalized = key(directions);

  if (directions.length < 8) {
    return "Add clearer driver directions or a landmark of at least 8 characters.";
  }
  if (directions.length > 1000) {
    return "Driver directions must be 1000 characters or fewer.";
  }
  if (GENERIC_DIRECTIONS.has(normalized)) {
    return "Add a real landmark, road detail, gate, or meeting point for the driver.";
  }

  const identityValues = [
    input.contactName,
    input.vendorName,
    input.town,
    input.barangay,
  ]
    .map(key)
    .filter(Boolean);

  if (identityValues.includes(normalized)) {
    return "Driver directions cannot be only the farmer, store, municipality, or barangay name. Add a landmark or road detail.";
  }

  const words = normalized.match(/[a-z0-9]+/g) || [];
  if (new Set(words).size < 2) {
    return "Add a real landmark, road detail, gate, or meeting point for the driver.";
  }

  return null;
}
