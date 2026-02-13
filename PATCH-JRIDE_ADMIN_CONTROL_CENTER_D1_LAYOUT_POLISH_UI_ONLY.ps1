# PATCH-JRIDE_ADMIN_CONTROL_CENTER_D1_LAYOUT_POLISH_UI_ONLY.ps1
# UI-ONLY: Layout + hierarchy polish for Admin Control Center (no logic changes)

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\control-center\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw -Encoding utf8

# ---- Anchor 1: Replace the start of the return() block (top layout wrapper) ----
$anchor1 = 'return (
    <div style={{ padding: 16 }}>'
if ($txt.IndexOf($anchor1) -lt 0) { Fail "Anchor1 not found (return block start)" }

$replacement1 = @'
return (
    <div style={{ padding: 16 }}>
      {/* ===== ADMIN CONTROL CENTER: TOP HEADER (D1 UI ONLY) ===== */}
      <div className="mb-4 rounded-2xl border border-black/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold m-0">Admin Control Center</h1>
            <div className="mt-1 text-xs opacity-70">
              Centralized navigation hub. Read-only. No actions are executed here.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span style={badge}>
              Role: <b>{role}</b>{" "}
              <span style={{ opacity: 0.7 }}>
                {debug ? "(debug)" : ""} {roleSource ? " - " + roleSource : ""}
              </span>
            </span>

            {debug ? (
              <>
                <button type="button" style={miniBtn} onClick={() => setRoleHint("admin")}>
                  Set role: admin
                </button>
                <button type="button" style={miniBtn} onClick={() => setRoleHint("dispatcher")}>
                  Set role: dispatcher
                </button>
              </>
            ) : null}

            <a href="/admin" style={btn}>
              /admin
            </a>
            <a href="/admin/control-center" style={btn}>
              /admin/control-center
            </a>
          </div>
        </div>
      </div>
      {/* ===== END TOP HEADER ===== */}
'@

$txt2 = $txt.Replace($anchor1, $replacement1)

# ---- Anchor 2: Remove the old H1 + subtitle + role row block (now duplicated) ----
$startOld = '<h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Admin Control Center</h1>'
$endOld = '</div>' + "`r`n" + ''  # we'll remove via a more reliable anchor below

# We remove a known contiguous block starting at the old H1 and ending right after the quick links row.
$anchor2a = '<h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Admin Control Center</h1>'
$anchor2b = '</a>' + "`r`n" + '      </div>'  # closes the flex row containing /admin links

$posA = $txt2.IndexOf($anchor2a)
if ($posA -lt 0) { Fail "Anchor2a not found (old H1)" }
$posB = $txt2.IndexOf($anchor2b, $posA)
if ($posB -lt 0) { Fail "Anchor2b not found (end of old role/links row)" }

$cutStart = $posA
$cutEnd = $posB + $anchor2b.Length

$before = $txt2.Substring(0, $cutStart)
$after = $txt2.Substring($cutEnd)

$txt3 = $before + $after

if ($txt3 -eq $txt) { Fail "Patch produced no changes (unexpected)." }

Set-Content -Path $target -Value $txt3 -Encoding utf8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "Run build:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Commit/tag suggestion:"
Write-Host "  chore(admin-control-center): D1 layout polish (UI only)"
Write-Host "  JRIDE_ADMIN_CONTROL_CENTER_D1_UI_ONLY_GREEN"
