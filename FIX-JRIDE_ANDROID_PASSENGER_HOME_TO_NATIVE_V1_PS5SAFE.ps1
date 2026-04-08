param(
  [Parameter(Mandatory = $true)]
  [string]$AndroidRoot
)

$ErrorActionPreference = "Stop"

function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Fail($m) { throw $m }

$target = Join-Path $AndroidRoot "app\src\main\java\com\jride\app\passenger\home\PassengerHomeActivity.kt"
if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target not found: $target"
}

$backupDir = Join-Path $AndroidRoot "app\src\main\java\com\jride\app\passenger\home\_patch_bak"
if (-not (Test-Path -LiteralPath $backupDir)) {
  New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $target (Join-Path $backupDir ("PassengerHomeActivity.kt.bak.NATIVE_HOME_FIX_V1." + $stamp)) -Force
Ok "Backup created"

$content = @'
package com.jride.app.passenger.home

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.jride.app.R
import com.jride.app.common.api.ApiClient
import com.jride.app.common.api.ApiRoutes
import com.jride.app.common.storage.SessionManager
import com.jride.app.passenger.auth.PassengerLoginActivity
import com.jride.app.passenger.booking.PassengerBookRideActivity
import org.json.JSONObject

class PassengerHomeActivity : AppCompatActivity() {

    private lateinit var session: SessionManager

    private lateinit var textWelcome: TextView
    private lateinit var btnBookRide: Button
    private lateinit var btnLogout: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = SessionManager(this)

        if (!session.isLoggedIn) {
            goLogin()
            return
        }

        setContentView(R.layout.activity_passenger_home)

        textWelcome = findViewById(R.id.text_welcome)
        btnBookRide = findViewById(R.id.btn_book_ride)
        btnLogout = findViewById(R.id.btn_logout)

        val name = session.displayName ?: "Passenger"
        textWelcome.text = "Welcome, $name"

        btnBookRide.isEnabled = true
        btnBookRide.text = "Book Ride"
        btnBookRide.setOnClickListener {
            startActivity(Intent(this, PassengerBookRideActivity::class.java))
        }

        btnLogout.setOnClickListener { performLogout() }
    }

    private fun performLogout() {
        btnLogout.isEnabled = false

        Thread {
            try {
                ApiClient.post(ApiRoutes.AUTH_LOGOUT, JSONObject())
            } catch (_: Exception) {
            }

            runOnUiThread {
                session.clearSession()
                goLogin()
            }
        }.start()
    }

    private fun goLogin() {
        val intent = Intent(this, PassengerLoginActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }
}
'@

[System.IO.File]::WriteAllText($target, $content, [System.Text.Encoding]::UTF8)
Ok "Patched: $target"