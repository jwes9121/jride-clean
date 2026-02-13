# PATCH-JRIDE_P6C_UI_USE_SUGGESTED_FARE_BUTTON_V2.ps1
# P6C: UI-only - "Use Suggested Fare" button copies suggested fare into a proposed fare draft input
# HARD RULES: ANCHOR_BASED_ONLY, NO_DECLARE, NO_REDECLARE_NO_DECLARE, DO_NOT_TOUCH_DISPATCH_STATUS

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path

$tw = Join-Path $root 'app\admin\livetrips\components\TripWalletPanel.tsx'
$lc = Join-Path $root 'app\admin\livetrips\LiveTripsClient.tsx'

if(!(Test-Path $tw)){ Fail "Missing required file: $tw" }
if(!(Test-Path $lc)){ Fail "Missing required file: $lc" }

# -------------------- PATCH TripWalletPanel.tsx --------------------
$twTxt = Get-Content -LiteralPath $tw -Raw -Encoding UTF8

# Anchor A: Props block (CRLF or LF)
$propsAnchorCRLF = "type Props = {`r`n  trip: any | null;`r`n};"
$propsAnchorLF   = "type Props = {`n  trip: any | null;`n};"

$propsAnchor = $null
if($twTxt.IndexOf($propsAnchorCRLF) -ge 0){ $propsAnchor = $propsAnchorCRLF }
elseif($twTxt.IndexOf($propsAnchorLF) -ge 0){ $propsAnchor = $propsAnchorLF }
else { Fail "TripWalletPanel anchor not found: Props block" }

# Backup
$twBak = "$tw.bak.$(Stamp)"
Copy-Item -LiteralPath $tw -Destination $twBak -Force
Write-Host "[OK] Backup: $twBak"

# Replace Props with compatibility + callback (single-quoted here-string)
$propsReplacement = @'
type Props = {
  // Accept both prop names (LiveTripsClient passes selectedTrip)
  trip?: any | null;
  selectedTrip?: any | null;

  // P6C: UI-only copy suggested fare into a draft field upstream
  onUseSuggestedFare?: (v: number) => void;
};
'@

$twTxt2 = $twTxt.Replace($propsAnchor, $propsReplacement.TrimEnd())
if($twTxt2 -eq $twTxt){ Fail "TripWalletPanel Props replace failed (no change)." }

# Anchor B: function signature
$fnRegex = 'export default function TripWalletPanel\(\{\s*trip\s*\}\s*:\s*Props\)\s*\{'
if(-not [regex]::IsMatch($twTxt2, $fnRegex)){
  Fail "TripWalletPanel anchor not found: export default function TripWalletPanel({ trip }: Props) {"
}

# Replace signature to accept props + derive trip safely (no declare)
$fnReplacement = @'
export default function TripWalletPanel(props: Props) {
  const trip = (props && (props as any).trip !== undefined) ? (props as any).trip : ((props as any).selectedTrip ?? null);
  const onUseSuggestedFare = (props as any)?.onUseSuggestedFare as ((v: number) => void) | undefined;
'@

$twTxt3 = [regex]::Replace($twTxt2, $fnRegex, $fnReplacement.TrimEnd(), 1)
if($twTxt3 -eq $twTxt2){ Fail "TripWalletPanel signature patch failed (no change)." }

# Anchor C: Suggested verified fare line in JSX
$jsxAnchor = 'Suggested verified fare: <span className="font-medium text-slate-700">{fmtMoney(suggestedFare)}</span>'
if($twTxt3.IndexOf($jsxAnchor) -lt 0){
  Fail "TripWalletPanel anchor not found: Suggested verified fare JSX line"
}

# Inject button right after suggested fare line
$buttonBlock = @'
Suggested verified fare: <span className="font-medium text-slate-700">{fmtMoney(suggestedFare)}</span>
            <button
              type="button"
              onClick={async () => {
                const n = asNum(suggestedFare);
                if (n === null) return;

                // UI-only: copy into upstream draft (preferred)
                if (onUseSuggestedFare) onUseSuggestedFare(n);

                // Bonus: clipboard copy (best-effort)
                try {
                  if (navigator && (navigator as any).clipboard && (navigator as any).clipboard.writeText) {
                    await (navigator as any).clipboard.writeText(String(n));
                  }
                } catch {}
              }}
              disabled={!(asNum(suggestedFare) !== null && (asNum(suggestedFare) as any) > 0)}
              className="ml-2 rounded border px-2 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Copy suggested fare into Proposed Fare (draft)"
            >
              Use Suggested Fare
            </button>
'@

$twTxt4 = $twTxt3.Replace($jsxAnchor, $buttonBlock.TrimEnd())
if($twTxt4 -eq $twTxt3){ Fail "TripWalletPanel button injection failed (no change)." }

Set-Content -LiteralPath $tw -Value $twTxt4 -Encoding UTF8
Write-Host "[OK] Patched: $tw"

# -------------------- PATCH LiveTripsClient.tsx --------------------
$lcTxt = Get-Content -LiteralPath $lc -Raw -Encoding UTF8

# Anchor D: lastAction state
$stateAnchor = 'const [lastAction, setLastAction] = useState<string>("");'
if($lcTxt.IndexOf($stateAnchor) -lt 0){
  Fail "LiveTripsClient anchor not found: $stateAnchor"
}

# Backup
$lcBak = "$lc.bak.$(Stamp)"
Copy-Item -LiteralPath $lc -Destination $lcBak -Force
Write-Host "[OK] Backup: $lcBak"

# Insert proposedFareDraft state + effect + handler
$insert = @'
const [lastAction, setLastAction] = useState<string>("");

  // P6C: UI-only proposed fare draft (no backend mutation)
  const [proposedFareDraft, setProposedFareDraft] = useState<string>("");

  useEffect(() => {
    // Keep draft in sync when selecting a trip (best-effort)
    if (!selectedTrip) {
      setProposedFareDraft("");
      return;
    }
    const v =
      (selectedTrip as any)?.proposed_fare ??
      (selectedTrip as any)?.proposedFare ??
      (selectedTrip as any)?.verified_fare ??
      (selectedTrip as any)?.verifiedFare ??
      null;

    const n = Number(v);
    if (Number.isFinite(n) && n > 0) setProposedFareDraft(String(n));
    else setProposedFareDraft("");
  }, [selectedTripId]);

  const handleUseSuggestedFare = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return;
    setProposedFareDraft(String(v));
    setLastAction("Copied suggested fare to Proposed Fare (draft).");
  };
'@

$lcTxt2 = $lcTxt.Replace($stateAnchor, $insert.TrimEnd())
if($lcTxt2 -eq $lcTxt){ Fail "LiveTripsClient state insert failed (no change)." }

# Anchor E: Fare card placeholder "--" (CRLF or LF)
$fareCardAnchorCRLF = "<div className=""font-semibold"">Fare</div>`r`n                <div className=""text-sm text-gray-600"">--</div>"
$fareCardAnchorLF   = "<div className=""font-semibold"">Fare</div>`n                <div className=""text-sm text-gray-600"">--</div>"

$fareAnchor = $null
if($lcTxt2.IndexOf($fareCardAnchorCRLF) -ge 0){ $fareAnchor = $fareCardAnchorCRLF }
elseif($lcTxt2.IndexOf($fareCardAnchorLF) -ge 0){ $fareAnchor = $fareCardAnchorLF }
else { Fail "LiveTripsClient anchor not found: Fare card placeholder '--'" }

$fareCardReplacement = @'
<div className="font-semibold">Fare</div>
                <div className="mt-1">
                  <div className="text-xs text-gray-500 mb-1">Proposed fare (draft)</div>
                  <input
                    value={proposedFareDraft}
                    onChange={(e) => setProposedFareDraft(e.target.value)}
                    placeholder="--"
                    className="w-full rounded border px-2 py-1 text-sm"
                    inputMode="decimal"
                  />
                  <div className="mt-1 text-[11px] text-gray-500">
                    UI-only draft. No backend update yet.
                  </div>
                </div>
'@

$lcTxt3 = $lcTxt2.Replace($fareAnchor, $fareCardReplacement.TrimEnd())
if($lcTxt3 -eq $lcTxt2){ Fail "LiveTripsClient Fare card replace failed (no change)." }

# Anchor F: TripWalletPanel render call
$twCallAnchor = '<TripWalletPanel selectedTrip={selectedTrip} />'
if($lcTxt3.IndexOf($twCallAnchor) -lt 0){
  Fail "LiveTripsClient anchor not found: $twCallAnchor"
}

$lcTxt4 = $lcTxt3.Replace($twCallAnchor, '<TripWalletPanel selectedTrip={selectedTrip} onUseSuggestedFare={handleUseSuggestedFare} />')
if($lcTxt4 -eq $lcTxt3){ Fail "LiveTripsClient TripWalletPanel prop wire failed (no change)." }

Set-Content -LiteralPath $lc -Value $lcTxt4 -Encoding UTF8
Write-Host "[OK] Patched: $lc"

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) Admin LiveTrips -> select a trip -> click 'Use Suggested Fare' -> Proposed fare (draft) input updates"
