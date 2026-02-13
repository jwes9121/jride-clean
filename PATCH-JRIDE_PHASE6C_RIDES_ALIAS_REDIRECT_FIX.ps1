# PATCH-JRIDE_PHASE6C_RIDES_ALIAS_REDIRECT_FIX.ps1
# Fix duplicate /rides route:
# - Remove app/rides/page.tsx
# - Patch app/(authed)/rides/page.tsx to redirect -> /ride
# ASCII ONLY.

$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function BackupFile($p) {
  if (Test-Path $p) {
    $bak = "$p.bak.$(Timestamp)"
    Copy-Item $p $bak -Force
    Write-Host "[OK] Backup: $bak"
  }
}
function WriteUtf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$badRides = "app\rides\page.tsx"
$authedRides = "app\(authed)\rides\page.tsx"

# 1) Remove the duplicate route file we created
if (Test-Path $badRides) {
  BackupFile $badRides
  Remove-Item $badRides -Force
  Write-Host "[OK] Removed duplicate: $badRides"
} else {
  Write-Host "[OK] No duplicate file found at: $badRides"
}

# 2) Patch the real existing /rides page inside (authed)
if (!(Test-Path $authedRides)) {
  throw "Expected file missing: $authedRides"
}

BackupFile $authedRides

$ridesTs = @'
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function RidesPage() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/ride");
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="text-sm opacity-70">Redirecting to /ride...</div>
    </main>
  );
}
'@

WriteUtf8NoBom $authedRides $ridesTs
Write-Host "[OK] Patched: $authedRides"
Write-Host "[NEXT] Build: npm.cmd run build"
