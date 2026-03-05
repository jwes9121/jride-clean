#requires -Version 5.1
<#
PATCH JRIDE WEB: Stabilize dispatch assign + status (V1.2 / PS5-safe / ASCII-only)

Targets:
- app\api\dispatch\assign\route.ts
- app\api\dispatch\status\route.ts

A) /dispatch/assign: allow cookie session (Supabase auth) OR admin secret OR allowUnauth env
   - NO fixed import anchors.
   - Detects Supabase server helper module path by scanning repo.
   - Inserts import only if helper exists.

B) /dispatch/status: remove JRIDE_P5C_POST_START_BLOCK; fix comment artifact containing `n; remove shadowed warnings redeclare

Refuses to patch if:
- allowRequest block cannot be located exactly once
- Supabase server helper module cannot be found (for session gate)
- P5C block not found exactly once
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) { throw $msg }
function NowStamp() { return (Get-Date).ToString("yyyyMMdd_HHmmss") }

function EnsureDir($p) {
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function ReadText($path) {
  if (-not (Test-Path -LiteralPath $path)) { Fail "Missing file: $path" }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function WriteTextUtf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile($src, $bakDir, $tag) {
  EnsureDir $bakDir
  $name = [System.IO.Path]::GetFileName($src)
  $dst = Join-Path $bakDir ($name + ".bak." + $tag + "." + (NowStamp))
  Copy-Item -LiteralPath $src -Destination $dst -Force
  return $dst
}

function ReplaceAllRegex_ExactlyOnce($content, $pattern, $replacement, $label) {
  $opts = [System.Text.RegularExpressions.RegexOptions]::Singleline
  $re = New-Object System.Text.RegularExpressions.Regex($pattern, $opts)
  $m = $re.Matches($content)
  if ($m.Count -lt 1) { Fail "PATCH FAIL ($label): pattern not found." }
  if ($m.Count -gt 1) { Fail "PATCH FAIL ($label): pattern matched multiple times ($($m.Count)). Refuse to patch." }
  return $re.Replace($content, $replacement)
}

function ReplaceLiteralOnce($content, $find, $replace, $label) {
  $idx = $content.IndexOf($find)
  if ($idx -lt 0) { Fail "PATCH FAIL ($label): literal not found." }
  $idx2 = $content.IndexOf($find, $idx + $find.Length)
  if ($idx2 -ge 0) { Fail "PATCH FAIL ($label): literal appears multiple times. Refuse to patch." }
  return $content.Replace($find, $replace)
}

function EnsureContains($content, $needle, $label) {
  if ($content.IndexOf($needle) -lt 0) { Fail "PATCH FAIL ($label): expected anchor missing: $needle" }
}

function StripNonAscii($s) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    if ([int][char]$ch -le 127) { [void]$sb.Append($ch) } else { [void]$sb.Append('-') }
  }
  return $sb.ToString()
}

function FindSupabaseServerHelperImport($root) {
  # We will search for common helper modules that export a server-side createClient()
  # Candidates (paths relative to root):
  $candidates = @(
    "utils\supabase\server.ts",
    "utils\supabase\server.tsx",
    "src\utils\supabase\server.ts",
    "src\utils\supabase\server.tsx",
    "lib\supabase\server.ts",
    "lib\supabase\server.tsx",
    "src\lib\supabase\server.ts",
    "src\lib\supabase\server.tsx"
  )

  foreach ($rel in $candidates) {
    $p = Join-Path $root $rel
    if (Test-Path -LiteralPath $p) {
      # quick content check: contains "createClient" export or function
      $t = ReadText $p
      if ($t -match "createClient") {
        # derive import path based on rel
        if ($rel -like "utils\supabase\server.*") { return "@/utils/supabase/server" }
        if ($rel -like "src\utils\supabase\server.*") { return "@/utils/supabase/server" }
        if ($rel -like "lib\supabase\server.*") { return "@/lib/supabase/server" }
        if ($rel -like "src\lib\supabase\server.*") { return "@/lib/supabase/server" }
      }
    }
  }

  # fallback: search repo for a file path containing "\supabase\server" with createClient inside
  $hits = Get-ChildItem -LiteralPath $root -Recurse -File -Include "server.ts","server.tsx" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\supabase\\server\.(ts|tsx)$" } |
    Select-Object -First 10

  foreach ($h in $hits) {
    $t = ReadText $h.FullName
    if ($t -match "createClient") {
      # best-effort guess of alias path by folder name, but still grounded by actual file location:
      if ($h.FullName -match "\\utils\\supabase\\server\.(ts|tsx)$") { return "@/utils/supabase/server" }
      if ($h.FullName -match "\\lib\\supabase\\server\.(ts|tsx)$") { return "@/lib/supabase/server" }
    }
  }

  return $null
}

Write-Host "== PATCH JRIDE WEB: Stabilize dispatch assign + status (V1.2 / PS5-safe / ASCII-only) ==" -ForegroundColor Cyan
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$bakDir = Join-Path $root "_patch_bak"
EnsureDir $bakDir

$assignPath = Join-Path $root "app\api\dispatch\assign\route.ts"
$statusPath = Join-Path $root "app\api\dispatch\status\route.ts"

# -----------------------------
# PATCH A: dispatch/assign
# -----------------------------
Write-Host "`n== PATCH A: app/api/dispatch/assign/route.ts ==" -ForegroundColor Yellow
$assign = ReadText $assignPath
$assignBak = BackupFile $assignPath $bakDir "STABILIZE_DISPATCH_ASSIGN_V1_2"
Write-Host "[OK] Backup: $assignBak"

# ASCII guard safety
$assign = StripNonAscii $assign

# Find Supabase server helper module path (grounded by file existence)
$helperImport = FindSupabaseServerHelperImport $root
if (-not $helperImport) {
  Fail "PATCH FAIL (ASSIGN_FIND_SUPABASE_SERVER_HELPER): Could not locate a supabase server helper module (e.g., utils/supabase/server.ts). Refusing to guess import path."
}
Write-Host "[OK] Found supabase server helper import path: $helperImport"

# Ensure we have an import we can use:
# We'll add: import { createClient as createSupabaseServerClient } from "<helperImport>";
# Only if not already present.
$importLine = 'import { createClient as createSupabaseServerClient } from "' + $helperImport + '";'
if ($assign.IndexOf($importLine) -lt 0) {
  # Insert after the last import ...; line at the top.
  $assign = ReplaceAllRegex_ExactlyOnce $assign '^(?s)(("use strict";\s*\r?\n)?("use client";\s*\r?\n)?(?:import[^\r\n]*\r?\n)+)' ('$1' + $importLine + "`r`n") "ASSIGN_INSERT_HELPER_IMPORT"
  Write-Host "[OK] Inserted helper import"
} else {
  Write-Host "[OK] Helper import already present"
}

# Replace allowRequest() exactly once (no anchor assumptions)
$assignPattern = '(?s)function\s+allowRequest\s*\(\s*req:\s*Request\s*\)\s*\{.*?\n\}'
$assignReplacement = @'
async function allowRequest(req: Request): Promise<{ ok: boolean; mode?: string; user_id?: string | null }> {
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_ASSIGN || "").trim() === "1";
  if (allowUnauth) return { ok: true, mode: "allowUnauth", user_id: null };

  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret = String(
    req.headers.get("x-jride-admin-secret") ||
    req.headers.get("x-admin-secret") ||
    ""
  ).trim();

  const secretOk = Boolean(wantSecret) && Boolean(gotSecret) && gotSecret === wantSecret;
  if (secretOk) return { ok: true, mode: "adminSecret", user_id: null };

  // Browser admin UI lane: allow valid Supabase session (cookie)
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id ?? null;
    if (uid) return { ok: true, mode: "session", user_id: uid };
  } catch {
    // ignore
  }

  return { ok: false };
}
'@
$assign = ReplaceAllRegex_ExactlyOnce $assign $assignPattern $assignReplacement "ASSIGN_REPLACE_ALLOWREQUEST"

# Update POST() gate usage
$assign = ReplaceAllRegex_ExactlyOnce $assign '(?s)if\s*\(\s*!\s*allowRequest\s*\(\s*req\s*\)\s*\)\s*\{' "const gate = await allowRequest(req);`n    if (!gate.ok) {" "ASSIGN_GATE_AWAIT"

# Update unauthorized message if present
$oldMsg = 'return jErr("UNAUTHORIZED", "Missing admin secret (or set JRIDE_ALLOW_UNAUTH_DISPATCH_ASSIGN=1 for debugging).", 401);'
$newMsg = 'return jErr("UNAUTHORIZED", "Not authenticated (admin secret or valid session required).", 401);'
if ($assign.IndexOf($oldMsg) -ge 0) {
  $assign = ReplaceLiteralOnce $assign $oldMsg $newMsg "ASSIGN_ERRMSG_UPDATE"
}

EnsureContains $assign "createSupabaseServerClient" "ASSIGN_HELPER_USED"
EnsureContains $assign "const gate = await allowRequest(req);" "ASSIGN_GATE_PRESENT"

WriteTextUtf8NoBom $assignPath $assign
Write-Host "[OK] Patched: $assignPath"

# -----------------------------
# PATCH B: dispatch/status
# -----------------------------
Write-Host "`n== PATCH B: app/api/dispatch/status/route.ts ==" -ForegroundColor Yellow
$status = ReadText $statusPath
$statusBak = BackupFile $statusPath $bakDir "STABILIZE_DISPATCH_STATUS_V1_2"
Write-Host "[OK] Backup: $statusBak"

# Remove JRIDE_P5C_POST_START_BLOCK exactly once
$blockPattern = '(?s)\r?\n\s*\/\/\s*=====\s*JRIDE_P5C_POST_START_BLOCK.*?\/\/\s*=====\s*END\s+JRIDE_P5C_POST_START_BLOCK\s*=====\s*\r?\n'
$blockCount = [regex]::Matches($status, $blockPattern).Count
if ($blockCount -ne 1) { Fail "PATCH FAIL (STATUS_REMOVE_P5C_BLOCK): expected 1 block, found $blockCount" }
$status = [regex]::Replace($status, $blockPattern, "`n")
Write-Host "[OK] Removed JRIDE_P5C_POST_START_BLOCK"

# Fix TS comment artifact containing `n inside TS
$status = $status.Replace(').`n  if (s === "assigned") return null;', ").`r`n  if (s === ""assigned"") return null;")

# Remove shadowed redeclare inside bestEffortWalletSyncOnComplete()
$shadowPattern = '(?s)(async\s+function\s+bestEffortWalletSyncOnComplete\s*\(.*?\)\s*\{.*?\r?\n)(\s*)const\s+warnings\s*:\s*string\[\]\s*=\s*\[\]\s*;\s*\r?\n'
if ([regex]::Matches($status, $shadowPattern).Count -ge 1) {
  $status = [regex]::Replace($status, $shadowPattern, '$1$2', 1)
  Write-Host "[OK] Removed shadowed warnings redeclare inside bestEffortWalletSyncOnComplete()"
} else {
  Write-Host "[WARN] Shadowed warnings redeclare not found (skipped)"
}

WriteTextUtf8NoBom $statusPath $status
Write-Host "[OK] Patched: $statusPath"

Write-Host "`n== PATCH COMPLETE ==" -ForegroundColor Green
Write-Host "Run gates now:"
Write-Host "  1) npm run build"
Write-Host "  2) In browser admin UI: POST /api/dispatch/assign should be 200"