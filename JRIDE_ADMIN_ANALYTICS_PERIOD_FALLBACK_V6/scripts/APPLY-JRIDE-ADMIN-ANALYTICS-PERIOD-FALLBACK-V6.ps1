$ErrorActionPreference = 'Stop'
Write-Host 'JRIDE ADMIN ANALYTICS PERIOD FALLBACK V6 - APPLY'

$PagePath = 'app\admin\analytics\page.tsx'
if (!(Test-Path -LiteralPath $PagePath)) { throw "Missing file: $PagePath" }

$BackupPath = "$PagePath.bak_period_fallback_v6_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $PagePath -Destination $BackupPath -Force

$Content = Get-Content -LiteralPath $PagePath -Raw

if ($Content -notmatch 'tripApiPeriods') {
  $Needle = '  const [tripRows, setTripRows] = React.useState<TripsTownRow[]>([]);'
  $Insert = @'
  const [tripRows, setTripRows] = React.useState<TripsTownRow[]>([]);
  const [tripApiPeriods, setTripApiPeriods] = React.useState<Partial<Record<PeriodKey, TripPeriodMetrics>> | null>(null);
'@
  if (!$Content.Contains($Needle)) { throw 'Marker not found: tripRows state' }
  $Content = $Content.Replace($Needle, $Insert.TrimEnd())
}

if ($Content -notmatch 'setTripApiPeriods\(tripsJson\.periods') {
  $Needle = '      setTripRows(Array.isArray(tripsJson.rows) ? tripsJson.rows : []);'
  $Insert = @'
      setTripRows(Array.isArray(tripsJson.rows) ? tripsJson.rows : []);
      setTripApiPeriods(tripsJson.periods || null);
'@
  if (!$Content.Contains($Needle)) { throw 'Marker not found: setTripRows' }
  $Content = $Content.Replace($Needle, $Insert.TrimEnd())
}

$Old = @'
  const periodTotals = React.useMemo(() => {
    const blank = () => ({
      totalTrips: 0,
      rideTrips: 0,
      takeoutTrips: 0,
      companyShareTotal: 0,
      todaShareTotal: 0,
      takeoutServiceFeeTotal: 0,
      takeoutTotalPayable: 0,
    });
    const result: Record<PeriodKey, ReturnType<typeof blank>> = {
      today: blank(),
      week: blank(),
      month: blank(),
    };
    for (const row of scopedTrips) {
      for (const key of ["today", "week", "month"] as PeriodKey[]) {
        const p = row.periods?.[key];
        if (!p) continue;
        result[key].totalTrips += Number(p.total_trips || 0);
        result[key].rideTrips += Number(p.ride_trips || 0);
        result[key].takeoutTrips += Number(p.takeout_trips || 0);
        result[key].companyShareTotal += Number(p.company_share_total || 0);
        result[key].todaShareTotal += Number(p.toda_share_total || 0);
        result[key].takeoutServiceFeeTotal += Number(
          p.takeout_service_fee_total || 0,
        );
        result[key].takeoutTotalPayable += Number(
          p.takeout_total_payable || 0,
        );
      }
    }
    return result;
  }, [scopedTrips]);
'@

$New = @'
  const periodTotals = React.useMemo(() => {
    const blank = () => ({
      totalTrips: 0,
      rideTrips: 0,
      takeoutTrips: 0,
      companyShareTotal: 0,
      todaShareTotal: 0,
      takeoutServiceFeeTotal: 0,
      takeoutTotalPayable: 0,
    });
    const result: Record<PeriodKey, ReturnType<typeof blank>> = {
      today: blank(),
      week: blank(),
      month: blank(),
    };

    const applyPeriod = (key: PeriodKey, p?: TripPeriodMetrics | null) => {
      if (!p) return;
      result[key].totalTrips += Number(p.total_trips || 0);
      result[key].rideTrips += Number(p.ride_trips || 0);
      result[key].takeoutTrips += Number(p.takeout_trips || 0);
      result[key].companyShareTotal += Number(p.company_share_total || 0);
      result[key].todaShareTotal += Number(p.toda_share_total || 0);
      result[key].takeoutServiceFeeTotal += Number(p.takeout_service_fee_total || 0);
      result[key].takeoutTotalPayable += Number(p.takeout_total_payable || 0);
    };

    if (scope === "all" && tripApiPeriods) {
      for (const key of ["today", "week", "month"] as PeriodKey[]) {
        applyPeriod(key, tripApiPeriods[key] || null);
      }
      return result;
    }

    for (const row of scopedTrips) {
      for (const key of ["today", "week", "month"] as PeriodKey[]) {
        applyPeriod(key, row.periods?.[key] || null);
      }
    }
    return result;
  }, [scopedTrips, scope, tripApiPeriods]);
'@

if (!$Content.Contains($Old)) { throw 'Marker not found: periodTotals block' }
$Content = $Content.Replace($Old, $New)

Set-Content -LiteralPath $PagePath -Value $Content -Encoding UTF8
Write-Host "Updated: $PagePath"
Write-Host "Backup created: $BackupPath"
Write-Host 'Apply complete. Run verify next.'
