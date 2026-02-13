# PATCH-DISPATCH-AUDIT-PANEL.ps1
# Safely adds dispatch audit history panel to DispatchActionPanel.tsx
# PowerShell-safe (uses regex replace where needed)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$f = "app/admin/livetrips/components/DispatchActionPanel.tsx"
if (!(Test-Path $f)) { Fail "Missing $f" }

$t = Get-Content $f -Raw -Encoding UTF8

# 1) Ensure useEffect is imported
if ($t -notmatch "useEffect") {
  $t = $t.Replace(
    'import React',
    'import React, { useEffect }'
  )
}

# 2) Add audit state
if ($t -notmatch "const \[audit, setAudit\]") {
  $t = $t.Replace(
    'const \[msg, setMsg\] = useState<string>\(""\);',
    'const [msg, setMsg] = useState<string>("");' + "`n" +
    'const [audit, setAudit] = useState<any[]>([]);'
  )
}

# 3) Insert audit-fetch effect AFTER FIRST useEffect
if ($t -notmatch "dispatch/audit") {
  $effect = @"

  // Fetch dispatch audit history
  useEffect(() => {
    if (!bookingCode) return;
    fetch(`/api/admin/dispatch/audit?bookingCode=${bookingCode}`)
      .then(r => r.json())
      .then(j => j?.ok && setAudit(j.data || []))
      .catch(() => {});
  }, [bookingCode]);

"@

  $rxFirstUseEffect = '(?s)useEffect\s*\(\s*\(\)\s*=>\s*\{.*?\}\s*,\s*\[.*?\]\s*\)\s*;'
  $m = [regex]::Match($t, $rxFirstUseEffect)
  if (!$m.Success) { Fail "Could not find a useEffect block to anchor audit fetch." }

  $t = $t.Insert($m.Index + $m.Length, $effect)
}

# 4) Render audit panel before component return end
if ($t -notmatch "Recent dispatch activity") {
  $panel = @"
      {audit.length > 0 && (
        <div className="mt-3 rounded border bg-slate-50 p-2 text-xs">
          <div className="mb-1 font-semibold text-slate-600">
            Recent dispatch activity
          </div>
          <div className="space-y-1">
            {audit.map((a, i) => (
              <div key={i} className="flex justify-between">
                <span className={a.ok ? "text-emerald-600" : "text-rose-600"}>
                  {a.ok ? "OK" : a.code}
                </span>
                <span className="opacity-70">{a.actor || "unknown"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
"@

  $rxReturnClose = '(?s)\}\s*\);\s*$'
  $t = [regex]::Replace($t, $rxReturnClose, $panel + "`n}`n);", 1)
}

Set-Content $f $t -Encoding UTF8
Write-Host "PATCHED: Dispatch audit panel added safely" -ForegroundColor Green
