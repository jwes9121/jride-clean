param(
  [string]$RepoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

$target = Join-Path $RepoRoot "app\api\public\auth\signup\route.ts"
if (!(Test-Path $target)) { Die "Missing: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("app_api_public_auth_signup_route.ts.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$src = Get-Content -LiteralPath $target -Raw

# 1) Add parsing for town_origin + barangay_origin after `const town = ...`
if ($src -notmatch "town_origin") {
  $needle = 'const town = String\(body\?\.(town) \?\? ""\)\.trim\(\);\s*'
  if ($src -match $needle) {
    $src = [regex]::Replace($src, $needle, @"
const town = String(body?.town ?? "").trim();
    const town_origin = String(body?.town_origin ?? "").trim();
    const barangay_origin = String(body?.barangay_origin ?? "").trim();

"@, 1)
    Ok "[OK] Added town_origin/barangay_origin parsing"
  } else {
    Die "Could not find the line: const town = String(body?.town ?? '').trim();"
  }
} else {
  Warn "[WARN] town_origin already present; skipping parsing insert"
}

# 2) Add to user_metadata block (non-breaking)
if ($src -match "user_metadata:\s*\{") {
  if ($src -notmatch "town_origin:\s") {
    # Insert just before signup_source
    $src = $src -replace 'signup_source:\s*"web",',
@'
town_origin: town_origin || null,
        barangay_origin: barangay_origin || null,
        signup_source: "web",
'@
    Ok "[OK] Added town_origin/barangay_origin to user_metadata"
  } else {
    Warn "[WARN] user_metadata already includes town_origin; skipping"
  }
} else {
  Die "Could not find user_metadata block."
}

# 3) Upsert into passenger_profiles after successful createUser and before return json
if ($src -notmatch 'from\("passenger_profiles"\)') {
  $insertAfter = 'if \(error\) \{[\s\S]*?\}\s*\r?\n\r?\n\s*return NextResponse\.json\(\{'
  if ($src -match $insertAfter) {
    $src = [regex]::Replace($src, $insertAfter, {
      param($m)
@"
if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
        return bad("This phone is already registered. Please login instead.", 409);
      }
      return bad(msg || "Signup failed.", 500);
    }

    // Save passenger origin profile (metadata only; does NOT restrict booking)
    try {
      const uid = data?.user?.id ?? null;
      if (uid) {
        await supabase
          .from("passenger_profiles")
          .upsert(
            { user_id: uid, town_origin: town_origin || null, barangay_origin: barangay_origin || null },
            { onConflict: "user_id" }
          );
      }
    } catch (e: any) {
      // non-fatal: do not block signup if profile write fails
    }

    return NextResponse.json({
"@
    }, 1)
    Ok "[OK] Added passenger_profiles upsert"
  } else {
    Die "Could not find insertion point before return NextResponse.json({ ... })."
  }
} else {
  Warn "[WARN] passenger_profiles upsert already present; skipping"
}

Set-Content -LiteralPath $target -Value $src -Encoding UTF8
Ok "[OK] Patched: app/api/public/auth/signup/route.ts"
Ok "Next: npm.cmd run build"
