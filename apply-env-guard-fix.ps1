$ErrorActionPreference = "Stop"

# ===== config =====
$enc = New-Object System.Text.UTF8Encoding($false)

# ===== 1) lazy, safe Supabase client =====
$newSb = @"
`"use client`";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/** Returns a Supabase client or null when env vars are missing. */
export default function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!_client) _client = createClient(url, key);
  return _client;
}

/** Helper that throws only when you explicitly assert. */
export function assertSupabase(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new Error("Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  return c;
}
"@
New-Item -ItemType Directory -Force -Path ".\lib" | Out-Null
[System.IO.File]::WriteAllText(".\lib\supabaseClient.ts", $newSb, $enc)

# ===== 2) EnvGuard component =====
$envGuard = @"
`"use client`";
import React from "react";

type Props = { children: React.ReactNode };

function hasEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export default function EnvGuard({ children }: Props) {
  if (!hasEnv()) {
    return (
      <div style={{padding:"12px",margin:"12px 0",border:"1px solid #f5c2c7",background:"#fff5f5",borderRadius:8,fontFamily:"system-ui"}}>
        <b>Supabase env not set</b><br/>
        Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> locally,
        or continue — page stays usable without Supabase calls.
      </div>
    );
  }
  return <>{children}</>;
}
"@
New-Item -ItemType Directory -Force -Path ".\components" | Out-Null
[System.IO.File]::WriteAllText(".\components\EnvGuard.tsx", $envGuard, $enc)

# ===== 3) Add force-dynamic + wrap in EnvGuard =====
function Add-DynamicAndGuard([string]$file) {
  if (-not (Test-Path $file)) { return }
  $txt = [System.IO.File]::ReadAllText($file)

  $changed = $false

  if ($txt -notmatch "export const dynamic = 'force-dynamic'") {
    $txt = "export const dynamic = 'force-dynamic';`r`n" + $txt
    $changed = $true
  }

  if ($txt -notmatch "from \"""\@/components/EnvGuard""\""") {
    # insert import after first line (safe, idempotent)
    $lines = $txt -split "`r?`n"
    if ($lines.Length -ge 1) {
      $lines[0] = $lines[0] + "`r`nimport EnvGuard from ""@/components/EnvGuard"";"
      $txt = ($lines -join "`r`n")
      $changed = $true
    }
  }

  if ($txt -notmatch "<EnvGuard>") {
    # wrap the first return (...) with <EnvGuard> ... </EnvGuard>
    $txt = $txt -replace "return\s*\(", "return (<EnvGuard>"
    $txt = $txt -replace "\)\s*;\s*$", "</EnvGuard>);"
    $changed = $true
  }

  if ($changed) {
    [System.IO.File]::WriteAllText($file, $txt, $enc)
  }
}

$targets = @(
  ".\app\dispatch\page.tsx",
  ".\app\admin\towns\page.tsx",
  ".\app\admin\drivers\page.tsx",
  ".\app\admin\audit\page.tsx",
  ".\app\ride\page.tsx",
  ".\app\website\page.tsx"
)
$targets | ForEach-Object { Add-DynamicAndGuard $_ }

# ===== 4) clean + build + push =====
if (Test-Path .\.next)  { Remove-Item -Recurse -Force .\.next }
if (Test-Path .\.turbo) { Remove-Item -Recurse -Force .\.turbo }

npm run build

git add -A
git commit -m "build: lazy supabase client; add EnvGuard; force-dynamic pages (dispatch/admin/ride/website)"
git push origin main