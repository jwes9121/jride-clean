# PATCH-JRIDE_PHASE6C_RIDES_ALIAS_REDIRECT.ps1
# Phase 6C: Make /rides redirect to /ride (ASCII only)

$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function EnsureDir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }
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

$ridesPage = "app\rides\page.tsx"
EnsureDir (Split-Path $ridesPage)
BackupFile $ridesPage

$ridesTs = @'
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function RidesAliasPage() {
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

WriteUtf8NoBom $ridesPage $ridesTs
Write-Host "[OK] Wrote: $ridesPage"
Write-Host "[NEXT] Build: npm.cmd run build"
