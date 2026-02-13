# PATCH-JRIDE_WALLET_ADJUST_REAL_DRIVER_AUTOSUGGEST_FIX_V1.ps1
# Purpose:
# - Fix duplicate state vars in app/admin/wallet-adjust/page.tsx (driversList/driverSearch/driverPick)
# - Fix JSX parse issues from jammed ";\s*const"
# - Remove mojibake strings (ASCII-only)
# - Implement real driver autosuggest (Name - Town (UUID)) and auto-fill UUID
# - Patch api/admin/wallet/driver-summary to return { id, name, town } best-effort

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

function Get-RepoRoot {
  $here = (Get-Location).Path
  $p = $here
  for ($i=0; $i -lt 12; $i++) {
    if (Test-Path (Join-Path $p "package.json")) { return $p }
    $parent = Split-Path -Parent $p
    if ($parent -eq $p) { break }
    $p = $parent
  }
  Fail "Could not find repo root (package.json). Run this from repo root."
}

function Backup-File($path) {
  if (!(Test-Path $path)) { Fail "Missing file: $path" }
  $ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Read-Text($path) {
  # Read raw (keeps file mostly intact)
  return [System.IO.File]::ReadAllText($path)
}

function Write-Text($path, $text) {
  # UTF-8 (no BOM)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

function Fix-Mojibake($s) {
  # ASCII-safe replacements only (do NOT insert fancy unicode)
  $repls = @(
    @{ from = "'"; to = "'" },
    @{ from = """; to = '"' },
    @{ from = """; to = '"' },
    @{ from = "-"; to = "-" },
    @{ from = "-"; to = "-" },
    @{ from = "â€¢"; to = "-" },
    @{ from = "·"; to = "-" },
    @{ from = ""; to = "" }
  )
  foreach ($r in $repls) { $s = $s.Replace($r.from, $r.to) }
  return $s
}

function Remove-Duplicate-StateLines($s, $needles) {
  # Removes duplicate lines that declare specific states.
  # Keeps first occurrence; removes later ones.
  $lines = $s -split "`r?`n"
  $seen = @{}
  $out = New-Object System.Collections.Generic.List[string]

  foreach ($ln in $lines) {
    $trim = $ln.Trim()
    $matched = $false
    foreach ($n in $needles) {
      if ($trim -match $n) {
        $matched = $true
        if ($seen.ContainsKey($n)) {
          # Skip duplicate
        } else {
          $seen[$n] = $true
          $out.Add($ln)
        }
        break
      }
    }
    if (!$matched) { $out.Add($ln) }
  }

  return ($out -join "`r`n")
}

function Ensure-DriverSummaryRoute($repo) {
  $routePath = Join-Path $repo "app\api\admin\wallet\driver-summary\route.ts"
  if (!(Test-Path $routePath)) {
    # Create if missing
    $dir = Split-Path -Parent $routePath
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Host "[OK] Created dir: $dir"
    Write-Text $routePath ""
  }

  Backup-File $routePath
  $src = Read-Text $routePath
  $src = Fix-Mojibake $src

  $new = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

// Best-effort select: try multiple column shapes without assuming schema.
async function trySelect(columns: string) {
  const q = supabase.from("drivers").select(columns).limit(1000);
  const res = await q;
  if (res.error) return null;
  return res.data ?? null;
}

function pickNameTown(row: any) {
  // Name candidates
  const name =
    row?.full_name ??
    row?.name ??
    row?.driver_name ??
    row?.display_name ??
    row?.username ??
    null;

  // Town/municipality candidates
  const town =
    row?.town ??
    row?.municipality ??
    row?.city ??
    row?.home_municipality ??
    row?.home_town ??
    row?.address_town ??
    null;

  return { name, town };
}

function looksTest(name: string | null) {
  if (!name) return true;
  const s = String(name).trim().toLowerCase();
  if (!s) return true;
  return (
    s.includes("test") ||
    s.includes("dev") ||
    s.includes("demo") ||
    s.includes("sample")
  );
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // Optional admin gate (if you configured ADMIN_API_KEY)
    const requiredKey = process.env.ADMIN_API_KEY || "";
    if (requiredKey) {
      const k = url.searchParams.get("admin_key") || req.headers.get("x-admin-key") || "";
      if (k !== requiredKey) return json(401, { ok: false, error: "Unauthorized" });
    }

    // Try columns in a safe order (do NOT assume any exist)
    const tries = [
      "id,full_name,town",
      "id,full_name,municipality",
      "id,name,town",
      "id,name,municipality",
      "id,driver_name,town",
      "id,driver_name,municipality",
      "id,display_name,town",
      "id,display_name,municipality",
      "id,username,town",
      "id,username,municipality",
      "id"
    ];

    let data: any[] | null = null;
    for (const cols of tries) {
      data = await trySelect(cols);
      if (data) break;
    }

    if (!data) return json(200, { ok: true, drivers: [] });

    const drivers = (data || [])
      .map((r: any) => {
        const nt = pickNameTown(r);
        return {
          id: String(r?.id ?? ""),
          name: nt.name ? String(nt.name) : null,
          town: nt.town ? String(nt.town) : null
        };
      })
      .filter((d: any) => d.id && !looksTest(d.name))
      .slice(0, 1000);

    return json(200, { ok: true, drivers });
  } catch (e: any) {
    return json(500, { ok: false, error: e?.message || "Server error" });
  }
}
'@

  Write-Text $routePath, $new
  Write-Host "[OK] Patched: $routePath"
}

function Patch-WalletAdjustPage($repo) {
  $pagePath = Join-Path $repo "app\admin\wallet-adjust\page.tsx"
  if (!(Test-Path $pagePath)) { Fail "Missing wallet adjust page: $pagePath" }

  Backup-File $pagePath
  $s = Read-Text $pagePath
  $s = Fix-Mojibake $s

  # Fix jammed tokens that often create parse errors:
  # ...;const [lookupBusy...  => ...;\n  const [lookupBusy...
  $s = [regex]::Replace($s, ";\s*const\s+\[", ";`r`n  const [")

  # Remove duplicate state lines (keep first occurrence)
  $needles = @(
    "const\s+\[driversList,\s*setDriversList\]\s*=\s*useState",
    "const\s+\[driverSearch,\s*setDriverSearch\]\s*=\s*useState",
    "const\s+\[driverPick,\s*setDriverPick\]\s*=\s*useState",
    "const\s+\[lookup,\s*setLookup\]\s*=\s*useState"
  )
  $s = Remove-Duplicate-StateLines $s $needles

  # Ensure we have states we need (insert if missing)
  if ($s -notmatch "const\s+\[driversList,\s*setDriversList\]") {
    # Insert near other useState declarations: after the first "useState" block.
    $ins = @'
  const [driversList, setDriversList] = useState<any[]>([]);
  const [driverSearch, setDriverSearch] = useState<string>("");
  const [driverPick, setDriverPick] = useState<string>(""); // label value: "Name - Town (UUID)"
'@
    $s = [regex]::Replace($s, "(useState<[^>]*>\([^\)]*\);\s*)", "`$1`r`n$ins", 1)
  }

  # Add/replace driver list loader + datalist logic (best-effort inject)
  # We anchor on the "Refresh driver list" text if present; otherwise we just ensure helper funcs exist.
  $helperBlock = @'
  async function loadDriversList() {
    try {
      const adminKey = (adminKeyInput || "").trim();
      const qs = adminKey ? ("?admin_key=" + encodeURIComponent(adminKey)) : "";
      const res = await fetch("/api/admin/wallet/driver-summary" + qs, {
        headers: adminKey ? { "x-admin-key": adminKey } : undefined
      });
      const j = await res.json();
      const raw = Array.isArray(j?.drivers) ? j.drivers : [];
      // Keep only real drivers (name exists) - route already filters tests, but double-filter here.
      const cleaned = raw
        .map((d: any) => ({
          id: String(d?.id ?? ""),
          name: d?.name ? String(d.name) : "",
          town: d?.town ? String(d.town) : ""
        }))
        .filter((d: any) => d.id && d.name && !/test|dev|demo|sample/i.test(d.name));
      setDriversList(cleaned);
    } catch (e) {
      // swallow; driver list is optional UX sugar
      setDriversList([]);
    }
  }

  function extractUuidFromPick(v: string) {
    const m = String(v || "").match(/\(([0-9a-fA-F-]{36})\)\s*$/);
    return m ? m[1] : "";
  }

  const driverSuggestions = useMemo(() => {
    const q = (driverSearch || "").trim().toLowerCase();
    if (!q) return [];
    const scored = driversList
      .map((d: any) => {
        const label = `${d.name}${d.town ? " - " + d.town : ""} (${d.id})`;
        const hay = (d.name + " " + (d.town || "") + " " + d.id).toLowerCase();
        const idx = hay.indexOf(q);
        return { d, label, idx };
      })
      .filter((x: any) => x.idx >= 0)
      .sort((a: any, b: any) => a.idx - b.idx)
      .slice(0, 30);
    return scored.map((x: any) => x.label);
  }, [driverSearch, driversList]);
'@

  if ($s -notmatch "function\s+loadDriversList\(") {
    # Insert helper block inside component: after "useEffect(" or after first state declarations.
    if ($s -match "useEffect\(") {
      $s = [regex]::Replace($s, "(useEffect\s*\()", "$helperBlock`r`n`r`n  `$1", 1)
    } else {
      # Put near top of component body after first "{"
      $s = [regex]::Replace($s, "{\s*\r?\n", "{`r`n$helperBlock`r`n", 1)
    }
  }

  # Ensure we call loadDriversList once on mount (or when adminKey changes)
  if ($s -notmatch "loadDriversList\(\)") {
    $s = [regex]::Replace(
      $s,
      "useEffect\s*\(\s*\(\)\s*=>\s*{",
      "useEffect(() => {`r`n    loadDriversList();",
      1
    )
  }

  # Replace/ensure the driver input is tied to driverSearch + datalist
  # We anchor on placeholder "Type name or town" which you already have.
  $s = [regex]::Replace($s,
    "<input([^>]*?)placeholder=""Type name or town[^""]*""([^>]*)>",
@'
<input$1placeholder="Type name or town (e.g. Juan or Lagawe)"$2
  value={driverSearch}
  onChange={(e) => {
    const v = e.target.value;
    setDriverSearch(v);
    setDriverPick(v);
    const uuid = extractUuidFromPick(v);
    if (uuid) setDriverId(uuid);
  }}
  list="jride_driver_suggestions"
/>
<datalist id="jride_driver_suggestions">
  {driverSuggestions.map((label) => (
    <option key={label} value={label} />
  ))}
</datalist>
'@,
    1
  )

  # Safety: when user clicks "Generate" or "Apply", ensure driverId syncs if they typed a picked value.
  if ($s -notmatch "extractUuidFromPick") {
    # already inserted above; keep
  }

  Write-Text $pagePath $s
  Write-Host "[OK] Patched: $pagePath"
}

# ---------------- main ----------------
$root = Get-RepoRoot
Write-Host "[INFO] Repo root: $root"

Ensure-DriverSummaryRoute $root
Patch-WalletAdjustPage $root

Write-Host ""
Write-Host "[OK] DONE."
Write-Host "Next: npm.cmd run build"
