# PATCH-LIVETRIPS-AUTOASSIGN-WIRING.ps1
# Robust: replace the entire <SmartAutoAssignSuggestions ... /> usage with a wired version.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# Match either:
# 1) Self-closing tag: <SmartAutoAssignSuggestions ... />
# 2) Wrapped tag: <SmartAutoAssignSuggestions ...>...</SmartAutoAssignSuggestions>
$rx = '(?s)<SmartAutoAssignSuggestions\b.*?(?:\/>|<\/SmartAutoAssignSuggestions>)'

$m = [regex]::Match($t, $rx)
if (!$m.Success) {
  Fail "Could not find <SmartAutoAssignSuggestions ...> usage in LiveTripsClient.tsx"
}

$new = @'
<SmartAutoAssignSuggestions
  trip={
    selectedTrip
      ? ({
          id: String((selectedTrip as any).id ?? (selectedTrip as any).uuid ?? (selectedTrip as any).booking_code ?? ""),
          pickupLat: Number((selectedTrip as any).pickup_lat),
          pickupLng: Number((selectedTrip as any).pickup_lng),
          zone: String((selectedTrip as any).town ?? (selectedTrip as any).zone ?? "Unknown"),
          tripType: String((selectedTrip as any).trip_type ?? (selectedTrip as any).service_type ?? "ride"),
        } as any)
      : null
  }
  drivers={
    (drivers || []).map((d: any) => ({
      id: String(d.driver_id ?? d.id ?? ""),
      name: String(d.name ?? "Driver"),
      lat: Number(d.lat),
      lng: Number(d.lng),
      zone: String(d.town ?? d.zone ?? "Unknown"),
      homeTown: String(d.town ?? d.homeTown ?? "Unknown"),
      status: String(d.status ?? "available"),
    })) as any
  }
  zoneStats={
    (zones || []).reduce((acc: any, z: any) => {
      const key = String(z.zone_name ?? z.key ?? "Unknown");
      acc[key] = { util: 0, status: String(z.status ?? "OK") };
      return acc;
    }, {} as any)
  }
  assignedDriverId={String((selectedTrip as any)?.driver_id ?? (selectedTrip as any)?.assigned_driver_id ?? "") || null}
  onAssign={async (driverId: string) => {
    if (!selectedTrip?.booking_code) return;
    await assignDriver(String(selectedTrip.booking_code), String(driverId));
  }}
  canAssign={(() => {
    const s = String((selectedTrip as any)?.status ?? "").toLowerCase().trim();
    return !(s === "on_trip" || s === "completed" || s === "cancelled");
  })()}
/>
'@

# Replace first match only
$t2 = [regex]::Replace($t, $rx, $new.TrimEnd(), 1)
Set-Content -LiteralPath $f -Value $t2 -Encoding UTF8

Write-Host "PATCHED: SmartAutoAssignSuggestions wiring in $f" -ForegroundColor Green
