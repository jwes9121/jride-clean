param(
  [string]$AndroidRoot = "C:\Users\jwes9\AndroidStudioProjects\JRideApp"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Backup-File([string]$Path) {
  if (-not (Test-Path $Path)) { throw "Missing file: $Path" }
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak = "$Path.bak.$stamp"
  Copy-Item -Force $Path $bak
  Write-Host "[OK] Backup: $bak"
}

function Read-Text([string]$Path) {
  if (-not (Test-Path $Path)) { throw "Missing file: $Path" }
  return [System.IO.File]::ReadAllText($Path)
}

# ---------- Paths ----------
$mainKt = Join-Path $AndroidRoot "app\src\main\java\com\jride\app\MainActivity.kt"
$liveKt = Join-Path $AndroidRoot "app\src\main\java\com\jride\app\LiveLocationClient.kt"
$xml    = Join-Path $AndroidRoot "app\src\main\res\layout\activity_main.xml"

# ---------- Sanity ----------
if (-not (Test-Path $AndroidRoot)) { throw "AndroidRoot not found: $AndroidRoot" }
if (-not (Test-Path $mainKt)) { throw "MainActivity.kt not found at: $mainKt" }
if (-not (Test-Path $liveKt)) { throw "LiveLocationClient.kt not found at: $liveKt" }
if (-not (Test-Path $xml))    { throw "activity_main.xml not found at: $xml" }

Backup-File $mainKt
Backup-File $liveKt
Backup-File $xml

# ---------- Patch LiveLocationClient.kt ----------
$txt = Read-Text $liveKt

if ($txt -match "fun\s+fetchWalletAsync\s*\(") {
  Write-Host "[SKIP] LiveLocationClient.kt already contains fetchWalletAsync()."
} else {

  $anchor = "`n}"
  if (-not $txt.Contains($anchor)) { throw "Could not find file end anchor in LiveLocationClient.kt" }

  $walletFn = @'
    fun fetchWalletAsync(
        driverId: String,
        onDone: (ok: Boolean, walletBalance: Double, minRequired: Double, locked: Boolean, status: String?, msg: String?) -> Unit
    ) {
        val url = "https://app.jride.net/api/driver/wallet?driver_id=$driverId"
        val req = Request.Builder().url(url).get().build()

        client.newCall(req).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: IOException) {
                onDone(false, 0.0, 0.0, false, null, e.message)
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                val bodyText = try { response.body?.string() } catch (_: Exception) { null }
                response.close()

                if (!response.isSuccessful || bodyText.isNullOrBlank()) {
                    onDone(false, 0.0, 0.0, false, null, "HTTP ${response.code}")
                    return
                }

                try {
                    val json = JSONObject(bodyText)
                    val ok = json.optBoolean("ok", false)
                    if (!ok) {
                        onDone(false, 0.0, 0.0, false, null, json.optString("error"))
                        return
                    }

                    val d = json.getJSONObject("driver")
                    val bal = d.optDouble("wallet_balance", 0.0)
                    val minReq = d.optDouble("min_wallet_required", 0.0)
                    val locked = d.optBoolean("wallet_locked", false)
                    val status = d.optString("driver_status", null)

                    onDone(true, bal, minReq, locked, status, null)
                } catch (e: Exception) {
                    onDone(false, 0.0, 0.0, false, null, e.message)
                }
            }
        })
    }

'@

  # Insert walletFn before the final "}"
  $idx = $txt.LastIndexOf("}")
  if ($idx -lt 0) { throw "Could not locate final closing brace in LiveLocationClient.kt" }
  $txt2 = $txt.Substring(0, $idx) + $walletFn + $txt.Substring($idx)

  Write-Utf8NoBom $liveKt $txt2
  Write-Host "[OK] Patched LiveLocationClient.kt: added fetchWalletAsync()"
}

# ---------- Patch MainActivity.kt ----------
$txt = Read-Text $mainKt

# 1) Add new lateinit TextViews after textHint
if ($txt -match "textWalletBalance") {
  Write-Host "[SKIP] MainActivity.kt already contains wallet TextViews."
} else {
  $declAnchor = "private lateinit var textHint: TextView"
  if (-not $txt.Contains($declAnchor)) { throw "Could not find anchor '$declAnchor' in MainActivity.kt" }

  $insertDecl = @'
private lateinit var textHint: TextView

    private lateinit var textWalletBalance: TextView
    private lateinit var textWalletMin: TextView
    private lateinit var textWalletLocked: TextView

'@

  $txt = $txt.Replace($declAnchor, $insertDecl)
  Write-Host "[OK] MainActivity.kt: inserted wallet TextView declarations"
}

# 2) Bind findViewById for new TextViews after textHint binding
if (-not ($txt -match "findViewById\(R\.id\.text_wallet_balance\)")) {
  $bindAnchor = "textHint = findViewById(R.id.text_hint)"
  if (-not $txt.Contains($bindAnchor)) { throw "Could not find anchor '$bindAnchor' in MainActivity.kt" }

  $bindInsert = @'
textHint = findViewById(R.id.text_hint)

        textWalletBalance = findViewById(R.id.text_wallet_balance)
        textWalletMin = findViewById(R.id.text_wallet_min)
        textWalletLocked = findViewById(R.id.text_wallet_locked)
'@

  $txt = $txt.Replace($bindAnchor, $bindInsert)
  Write-Host "[OK] MainActivity.kt: inserted wallet findViewById bindings"
}

# 3) Add helper functions fmtMoney + refreshWalletUi (once)
if (-not ($txt -match "private\s+fun\s+refreshWalletUi\s*\(")) {
  # Insert near other helpers; anchor on prefs() or getSavedDriverId()
  $helperAnchor = "private fun prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)"
  if (-not $txt.Contains($helperAnchor)) { throw "Could not find anchor '$helperAnchor' to insert helpers in MainActivity.kt" }

  $helpers = @'
private fun prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun fmtMoney(v: Double): String {
        return "₱" + String.format("%,.2f", v)
    }

    private fun refreshWalletUi() {
        val driverId = getSavedDriverId()
        if (driverId.isBlank()) {
            textWalletBalance.text = "Wallet Balance: -"
            textWalletMin.text = "Min Required: -"
            textWalletLocked.text = "Wallet Status: -"
            return
        }

        LiveLocationClient.fetchWalletAsync(driverId) { ok, bal, minReq, locked, status, msg ->
            runOnUiThread {
                if (!ok) {
                    textWalletBalance.text = "Wallet Balance: -"
                    textWalletMin.text = "Min Required: -"
                    textWalletLocked.text = "Wallet Status: -"
                    return@runOnUiThread
                }

                textWalletBalance.text = "Wallet Balance: ${fmtMoney(bal)}"
                textWalletMin.text = "Min Required: ${fmtMoney(minReq)}"
                textWalletLocked.text = if (locked) "Wallet Status: LOCKED" else "Wallet Status: ACTIVE"
            }
        }
    }

'@

  $txt = $txt.Replace($helperAnchor, $helpers)
  Write-Host "[OK] MainActivity.kt: inserted fmtMoney() + refreshWalletUi()"
}

# 4) Call refreshWalletUi() after applyUiForMode(getMode()) in onCreate
# Make it idempotent: add only if not present near that line
if (-not ($txt -match "applyUiForMode\(getMode\(\)\)\s*\r?\n\s*refreshWalletUi\(\)")) {
  $callAnchor = "applyUiForMode(getMode())"
  if (-not $txt.Contains($callAnchor)) { throw "Could not find anchor '$callAnchor' in MainActivity.kt" }

  # Replace only the first occurrence in onCreate block (safe enough here)
  $txt = $txt -replace [regex]::Escape($callAnchor), ($callAnchor + "`r`n`r`n        refreshWalletUi()"), 1
  Write-Host "[OK] MainActivity.kt: added refreshWalletUi() after applyUiForMode(getMode())"
}

# 5) Call refreshWalletUi() after Save applies mode
if (-not ($txt -match "Toast\.makeText\(this,\s*`"Saved driver info`",")) {
  Write-Host "[WARN] Could not find 'Saved driver info' toast anchor; skipping save-hook call."
} else {
  if (-not ($txt -match "Toast\.makeText\(this,\s*`"Saved driver info`".*applyUiForMode\(getMode\(\)\).*refreshWalletUi\(\)"s)) {
    # Insert refresh call right after applyUiForMode(getMode()) inside Save block
    $saveAnchor = "applyUiForMode(getMode())"
    # We already injected one earlier (onCreate). We'll inject the next occurrence after Save toast by anchoring on toast line.
    $pattern = '(Toast\.makeText\(this,\s*"Saved driver info",\s*Toast\.LENGTH_SHORT\)\.show\(\)\s*\r?\n\s*applyUiForMode\(getMode\(\)\))'
    if ($txt -match $pattern) {
      $txt = [regex]::Replace($txt, $pattern, '$1' + "`r`n`r`n            refreshWalletUi()", 1)
      Write-Host "[OK] MainActivity.kt: added refreshWalletUi() after Save applyUiForMode(getMode())"
    } else {
      Write-Host "[WARN] Save hook anchor not matched; skipping."
    }
  } else {
    Write-Host "[SKIP] MainActivity.kt: Save block already refreshes wallet."
  }
}

Write-Utf8NoBom $mainKt $txt
Write-Host "[OK] Wrote MainActivity.kt"

# ---------- Patch activity_main.xml ----------
$xmlTxt = Read-Text $xml

# Ensure required IDs exist (we anchor on text_hint or text_mode area)
if ($xmlTxt -match 'android:id="@\+id/text_wallet_balance"') {
  Write-Host "[SKIP] activity_main.xml already has wallet TextViews."
} else {
  # Insert wallet block after text_hint TextView if present
  $hintIdx = $xmlTxt.IndexOf('android:id="@+id/text_hint"')
  if ($hintIdx -lt 0) {
    throw "Could not find TextView with id text_hint in activity_main.xml. Paste/upload activity_main.xml if it's different."
  }

  # Find end of the TextView tag that contains text_hint (self-closing or normal)
  $after = $xmlTxt.Substring($hintIdx)
  $endTagPos = $after.IndexOf("/>")
  $endClosePos = $after.IndexOf("</TextView>")
  $tagEnd = -1
  if ($endTagPos -ge 0 -and ($endClosePos -lt 0 -or $endTagPos -lt $endClosePos)) {
    $tagEnd = $hintIdx + $endTagPos + 2
  } elseif ($endClosePos -ge 0) {
    $tagEnd = $hintIdx + $endClosePos + "</TextView>".Length
  } else {
    throw "Could not detect end of text_hint TextView tag in activity_main.xml."
  }

  $walletXml = @'

    <TextView
        android:id="@+id/text_wallet_balance"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Wallet Balance: -"
        android:textSize="16sp"
        android:paddingTop="8dp" />

    <TextView
        android:id="@+id/text_wallet_min"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Min Required: -"
        android:textSize="14sp" />

    <TextView
        android:id="@+id/text_wallet_locked"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Wallet Status: -"
        android:textSize="14sp" />

'@

  $xmlTxt2 = $xmlTxt.Substring(0, $tagEnd) + $walletXml + $xmlTxt.Substring($tagEnd)
  Write-Utf8NoBom $xml $xmlTxt2
  Write-Host "[OK] Patched activity_main.xml: inserted wallet TextViews after text_hint"
}

Write-Host ""
Write-Host "=============================="
Write-Host "[DONE] Android wallet UI patch complete."
Write-Host "Next: build APK and test. Wallet should show balance/min/locked."
Write-Host "=============================="
