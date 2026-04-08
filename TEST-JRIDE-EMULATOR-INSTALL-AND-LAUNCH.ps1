param(
  [string]$ProjRoot = "C:\Users\jwes9\AndroidStudioProjects\JRideApp",
  [string]$ApkPath = "",
  [string]$AvdName = "",
  [int]$BootTimeoutSeconds = 420
)

$ErrorActionPreference = "Stop"

function Write-Section([string]$title) {
  Write-Host ""
  Write-Host ("=" * 100) -ForegroundColor Cyan
  Write-Host $title -ForegroundColor Cyan
  Write-Host ("=" * 100) -ForegroundColor Cyan
}

function Find-SdkRoot {
  $candidates = @()

  if ($env:ANDROID_SDK_ROOT) { $candidates += $env:ANDROID_SDK_ROOT }
  if ($env:ANDROID_HOME) { $candidates += $env:ANDROID_HOME }

  $local1 = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  $local2 = "C:\Android\Sdk"

  $candidates += $local1
  $candidates += $local2

  foreach ($p in $candidates | Select-Object -Unique) {
    if ($p -and (Test-Path $p)) {
      return $p
    }
  }

  throw "Android SDK not found. Set ANDROID_SDK_ROOT or install Android SDK."
}

function Resolve-ToolPath([string]$sdkRoot, [string[]]$relativeCandidates) {
  foreach ($rel in $relativeCandidates) {
    $full = Join-Path $sdkRoot $rel
    if (Test-Path $full) {
      return $full
    }
  }
  throw "Tool not found under SDK: $($relativeCandidates -join ', ')"
}

function Get-LatestApk([string]$root) {
  $apkCandidates = @(
    (Join-Path $root "app\build\outputs\apk\release\app-release.apk"),
    (Join-Path $root "app\build\outputs\apk\debug\app-debug.apk")
  )

  foreach ($apk in $apkCandidates) {
    if (Test-Path $apk) {
      return $apk
    }
  }

  $all = Get-ChildItem -Path $root -Recurse -Filter *.apk -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending

  if ($all.Count -gt 0) {
    return $all[0].FullName
  }

  throw "No APK found under: $root"
}

function Get-AvdNames([string]$emulatorExe) {
  $out = & $emulatorExe -list-avds 2>$null
  if (-not $out) { return @() }
  return @($out | Where-Object { $_ -and $_.Trim().Length -gt 0 })
}

function Get-ConnectedEmulatorSerial([string]$adbExe) {
  $lines = & $adbExe devices
  foreach ($line in $lines) {
    if ($line -match "^(emulator-\d+)\s+device$") {
      return $Matches[1]
    }
  }
  return $null
}

function Wait-For-EmulatorBoot([string]$adbExe, [int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)

  while ((Get-Date) -lt $deadline) {
    $serial = Get-ConnectedEmulatorSerial -adbExe $adbExe
    if ($serial) {
      try {
        $boot = (& $adbExe -s $serial shell getprop sys.boot_completed 2>$null | Out-String).Trim()
        if ($boot -eq "1") {
          $anim = (& $adbExe -s $serial shell getprop init.svc.bootanim 2>$null | Out-String).Trim()
          if ($anim -eq "stopped" -or [string]::IsNullOrWhiteSpace($anim)) {
            return $serial
          }
        }
      } catch {
      }
    }
    Start-Sleep -Seconds 5
  }

  throw "Emulator did not finish booting within $timeoutSec seconds."
}

function Ensure-DeviceAwake([string]$adbExe, [string]$serial) {
  & $adbExe -s $serial shell input keyevent 82 | Out-Null
  & $adbExe -s $serial shell wm dismiss-keyguard 2>$null | Out-Null
}

function Install-Apk([string]$adbExe, [string]$serial, [string]$apkPath) {
  Write-Host "Installing APK: $apkPath" -ForegroundColor Yellow
  $output = & $adbExe -s $serial install -r -d $apkPath 2>&1
  $text = ($output | Out-String).Trim()
  Write-Host $text
  if ($LASTEXITCODE -ne 0 -or $text -notmatch "Success") {
    throw "APK install failed."
  }
}

function Launch-App([string]$adbExe, [string]$serial) {
  $launchTried = $false

  Write-Host "Trying explicit activity launch: com.jride.app/.RoleSelectActivity" -ForegroundColor Yellow
  $launchTried = $true
  $out1 = & $adbExe -s $serial shell am start -W -n "com.jride.app/.RoleSelectActivity" 2>&1
  $txt1 = ($out1 | Out-String).Trim()
  Write-Host $txt1

  if ($LASTEXITCODE -eq 0 -and $txt1 -notmatch "Error|Exception|does not exist|Activity class") {
    return
  }

  Write-Host "Explicit launch failed. Trying monkey launcher fallback for package com.jride.app" -ForegroundColor Yellow
  $out2 = & $adbExe -s $serial shell monkey -p com.jride.app -c android.intent.category.LAUNCHER 1 2>&1
  $txt2 = ($out2 | Out-String).Trim()
  Write-Host $txt2

  if ($LASTEXITCODE -ne 0 -or $txt2 -match "No activities found|monkey aborted|Error") {
    throw "App launch failed."
  }
}

function Show-Top-Activity([string]$adbExe, [string]$serial) {
  Write-Host "Top activity check:" -ForegroundColor Yellow
  $out = & $adbExe -s $serial shell dumpsys window windows 2>&1 | Select-String -Pattern "mCurrentFocus|mFocusedApp"
  $txt = ($out | Out-String).Trim()
  if ($txt) {
    Write-Host $txt
  } else {
    Write-Host "Could not read top activity." -ForegroundColor DarkYellow
  }
}

Write-Section "1. RESOLVE SDK TOOLS"
$sdkRoot = Find-SdkRoot
$adbExe = Resolve-ToolPath -sdkRoot $sdkRoot -relativeCandidates @(
  "platform-tools\adb.exe"
)
$emulatorExe = Resolve-ToolPath -sdkRoot $sdkRoot -relativeCandidates @(
  "emulator\emulator.exe"
)

Write-Host "SDK Root : $sdkRoot"
Write-Host "ADB      : $adbExe"
Write-Host "Emulator : $emulatorExe"

Write-Section "2. RESOLVE APK"
if ([string]::IsNullOrWhiteSpace($ApkPath)) {
  $ApkPath = Get-LatestApk -root $ProjRoot
}
if (-not (Test-Path $ApkPath)) {
  throw "APK not found: $ApkPath"
}
$apkItem = Get-Item $ApkPath
Write-Host "APK Path : $($apkItem.FullName)"
Write-Host ("APK Size : {0:N0} bytes" -f $apkItem.Length)
Write-Host "Modified : $($apkItem.LastWriteTime)"

Write-Section "3. RESOLVE AVD"
$avds = Get-AvdNames -emulatorExe $emulatorExe
if (-not $avds -or $avds.Count -eq 0) {
  throw "No AVD found. Create an emulator first in Android Studio Device Manager."
}

if ([string]::IsNullOrWhiteSpace($AvdName)) {
  $AvdName = $avds[0]
}

if ($avds -notcontains $AvdName) {
  Write-Host "Available AVDs:" -ForegroundColor Yellow
  $avds | ForEach-Object { Write-Host " - $_" }
  throw "Requested AVD not found: $AvdName"
}

Write-Host "Using AVD: $AvdName"

Write-Section "4. START EMULATOR"
$existingSerial = Get-ConnectedEmulatorSerial -adbExe $adbExe
if ($existingSerial) {
  Write-Host "An emulator is already connected: $existingSerial"
} else {
  Start-Process -FilePath $emulatorExe -ArgumentList @("-avd", $AvdName) | Out-Null
  Write-Host "Emulator launch command sent."
}

Write-Section "5. WAIT FOR BOOT"
$serial = Wait-For-EmulatorBoot -adbExe $adbExe -timeoutSec $BootTimeoutSeconds
Write-Host "Booted emulator serial: $serial" -ForegroundColor Green
Ensure-DeviceAwake -adbExe $adbExe -serial $serial

Write-Section "6. INSTALL APK"
Install-Apk -adbExe $adbExe -serial $serial -apkPath $ApkPath

Write-Section "7. LAUNCH APP"
Launch-App -adbExe $adbExe -serial $serial
Start-Sleep -Seconds 5
Show-Top-Activity -adbExe $adbExe -serial $serial

Write-Section "8. DONE"
Write-Host "APK installed and launch command executed." -ForegroundColor Green
Write-Host "Emulator serial: $serial"
Write-Host "APK: $ApkPath"