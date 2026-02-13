# FIX-JRIDE_PHASE8G_SMARTAUTOASSIGN_PROPS.ps1
# Fix SmartAutoAssignSuggestions props: trips->trip, add drivers + zoneStats mapping
# No Mapbox/UI layout changes besides fixing this component usage.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Backup($p){
  if(!(Test-Path $p)){ Fail "Missing file: $p" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts" -ForegroundColor Green
}

$path = "app\admin\livetrips\LiveTripsClient.tsx"
Backup $path

$txt = Get-Content $path -Raw

# Replace the entire <SmartAutoAssignSuggestions ... /> block safely
$pattern = '(?s)<SmartAutoAssignSuggestions\s+[\s\S]*?\/>\s*'
$match = [regex]::Match($txt, $pattern)
if(-not $match.Success){
  Fail "Could not find <SmartAutoAssignSuggestions ... /> block to patch."
}

$replacement = @'
<SmartAutoAssignSuggestions
              drivers={(drivers || []).map((d: any, idx: number) => {
                const id = String(d?.id ?? d?.driver_id ?? idx);
                const name = String(d?.name ?? d?.driver_name ?? "Driver");
                const lat = Number(d?.lat ?? d?.latitude ?? d?.driver_lat ?? 0);
                const lng = Number(d?.lng ?? d?.longitude ?? d?.driver_lng ?? 0);
                const zone = String(d?.zone ?? d?.town ?? "Unknown");
                const homeTown = String(d?.homeTown ?? d?.home_town ?? d?.town ?? "Unknown");
                const status = String(d?.status ?? "online");
                return { id, name, lat, lng, zone, homeTown, status };
              })}
              trip={
                selectedTrip
                  ? {
                      id: String((selectedTrip as any)?.id ?? (selectedTrip as any)?.uuid ?? (selectedTrip as any)?.booking_code ?? ""),
                      pickupLat: Number((selectedTrip as any)?.pickup_lat ?? (selectedTrip as any)?.pickupLat ?? 0),
                      pickupLng: Number((selectedTrip as any)?.pickup_lng ?? (selectedTrip as any)?.pickupLng ?? 0),
                      zone: String((selectedTrip as any)?.town ?? (selectedTrip as any)?.zone ?? "Unknown"),
                      tripType: String((selectedTrip as any)?.trip_type ?? (selectedTrip as any)?.tripType ?? (selectedTrip as any)?.service_type ?? ""),
                    }
                  : null
              }
              zoneStats={Object.fromEntries(
                (zones || []).map((z: any) => {
                  const key = String(z?.zone_name ?? z?.zone ?? z?.town ?? z?.zone_id ?? "Unknown");
                  const status = String(z?.status ?? "OK");
                  return [key, { util: 0, status }];
                })
              ) as any}
              assignedDriverId={String(
                (selectedTrip as any)?.driver_id ??
                  (selectedTrip as any)?.assigned_driver_id ??
                  (selectedTrip as any)?.driverId ??
                  ""
              ) || null}
              assigningDriverId={null}
              canAssign={
                !!selectedTrip &&
                !["on_trip", "completed", "cancelled"].includes(String((selectedTrip as any)?.status || "").toLowerCase())
              }
              lockReason="Trip already started"
              onAssign={async (driverId: string) => {
                if (!selectedTrip) return;
                const bookingCode =
                  (selectedTrip as any)?.booking_code ??
                  (selectedTrip as any)?.bookingCode ??
                  null;
                if (!bookingCode) return;
                await assignDriver(bookingCode, driverId);
              }}
            />
'@

$txt2 = [regex]::Replace($txt, $pattern, $replacement, 1)

Set-Content -Path $path -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched SmartAutoAssignSuggestions props (drivers + trip + zoneStats)" -ForegroundColor Green
