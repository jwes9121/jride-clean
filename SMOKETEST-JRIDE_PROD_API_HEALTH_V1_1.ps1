# SMOKETEST-JRIDE_PROD_API_HEALTH_V1_1.ps1
# JRide Production smoke test (no driver needed)
# - Confirms endpoints respond consistently
# - Measures HTTP code + latency
# - Writes a markdown report
# PS5-safe (no risky string interpolation inside AppendLine)

$ErrorActionPreference = "Stop"

$base = "https://app.jride.net"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$out = Join-Path (Get-Location).Path ("JRIDE_PROD_SMOKETEST_" + $ts + ".md")

function Invoke-Check {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Url
  )

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $resp = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing -TimeoutSec 20
    $sw.Stop()
    return @{
      name = $Name
      url = $Url
      ok = $true
      status = [int]$resp.StatusCode
      ms = [int]$sw.ElapsedMilliseconds
      note = ""
    }
  }
  catch {
    $sw.Stop()
    $status = ""
    $note = $_.Exception.Message
    try {
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $status = [int]$_.Exception.Response.StatusCode
      }
    } catch {}
    return @{
      name = $Name
      url = $Url
      ok = $false
      status = $status
      ms = [int]$sw.ElapsedMilliseconds
      note = $note
    }
  }
}

$checks = @(
  @{ name="Site root"; url=($base + "/") },
  @{ name="Ride page"; url=($base + "/ride") },

  # Some may require auth; report still useful.
  @{ name="Passenger booking poll (no code)"; url=($base + "/api/public/passenger/booking") },
  @{ name="Dispatch status (no params)"; url=($base + "/api/dispatch/status") },
  @{ name="Dispatch assign (no body)"; url=($base + "/api/dispatch/assign") },
  @{ name="Auth session"; url=($base + "/api/auth/session") }
)

$results = @()
foreach ($c in $checks) {
  $results += Invoke-Check -Name $c.name -Url $c.url
}

Start-Sleep -Seconds 2

$results2 = @()
foreach ($c in $checks) {
  $results2 += Invoke-Check -Name ($c.name + " (pass2)") -Url $c.url
}

$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("# JRIDE PROD SMOKETEST")
$null = $sb.AppendLine("")
$null = $sb.AppendLine("Generated: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
$null = $sb.AppendLine("Base: " + $base)
$null = $sb.AppendLine("")

function Add-Table {
  param([object[]]$arr, [string]$title)

  $null = $sb.AppendLine("## " + $title)
  $null = $sb.AppendLine("")
  $null = $sb.AppendLine("| Check | OK | HTTP | ms | URL | Note |")
  $null = $sb.AppendLine("| --- | --- | ---: | ---: | --- | --- |")

  foreach ($r in $arr) {
    $ok = if ($r.ok) { "✅" } else { "❌" }
    $status = if (($r.status + "") -ne "") { $r.status } else { "-" }
    $ms = $r.ms
    $url = ($r.url + "").Replace("|","\|")
    $note = ($r.note + "").Replace("`r"," ").Replace("`n"," ").Replace("|","\|")
    if ($note.Length -gt 140) { $note = $note.Substring(0, 140) + "…" }

    $line = "| " + $r.name + " | " + $ok + " | " + $status + " | " + $ms + " | `""
    $line = $line + $url + "`" | " + $note + " |"
    $null = $sb.AppendLine($line)
  }

  $null = $sb.AppendLine("")
}

Add-Table -arr $results -title "Pass 1"
Add-Table -arr $results2 -title "Pass 2"

$fail = @($results + $results2 | Where-Object { -not $_.ok })

$null = $sb.AppendLine("## Summary")
$null = $sb.AppendLine("")
if ($fail.Count -eq 0) {
  $null = $sb.AppendLine("- ✅ All checks returned HTTP 2xx/3xx successfully in both passes.")
} else {
  $null = $sb.AppendLine("- ⚠️ Some checks failed. Review the tables above.")
  $null = $sb.AppendLine("- Tip: 401/403 can be normal for protected endpoints; 429/5xx indicates limits/errors.")
}
$null = $sb.AppendLine("")

$sb.ToString() | Out-File -LiteralPath $out -Encoding UTF8
Write-Host ("[OK] Wrote report: " + $out)
