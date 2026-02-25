package com.jride.app

import android.util.Log
import androidx.core.view.updatePadding
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.ViewCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import android.Manifest
import android.app.AlertDialog
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.jride.app.data.JRideDeviceId
import com.jride.app.data.DriverProfileRepository
import nudge.DriverNudgeWatcher
import org.json.JSONObject
import java.util.Locale
import kotlin.math.roundToInt
import android.os.Handler
import android.os.Looper

class MainActivity : AppCompatActivity() {
    // === JRIDE_ACTIVE_TRIP_POLL_PREFS_V10_BEGIN ===
    // Single source poller. Prefs-first driver UUID read. Popup when new trip arrives.
    private val jrideActiveTripHandler: android.os.Handler = android.os.Handler(android.os.Looper.getMainLooper())
    private var jrideActiveTripRunning: Boolean = false
    private val jrideActiveTripIntervalMs: Long = 2500L
    private var jrideLastTripId: String? = null

    private val jrideActiveTripRunnable: Runnable = object : Runnable {
        override fun run() {
            if (!jrideActiveTripRunning) return
            try {
                jridePollActiveTripOnce()
            } catch (_: Exception) {
                // ignore (we keep polling)
            } finally {
                if (jrideActiveTripRunning) {
                    jrideActiveTripHandler.postDelayed(this, jrideActiveTripIntervalMs)
                }
            }
        }
    }

    private fun jrideStartActiveTripPolling() {
        if (jrideActiveTripRunning) return
        jrideActiveTripRunning = true
        jrideActiveTripHandler.removeCallbacks(jrideActiveTripRunnable)
        jrideActiveTripHandler.post(jrideActiveTripRunnable)
    }

    private fun jrideStopActiveTripPolling() {
        jrideActiveTripRunning = false
        jrideActiveTripHandler.removeCallbacks(jrideActiveTripRunnable)
    }

    private fun jrideGetDriverUuidForPoll(): String {
        // Prefer SharedPreferences (works even if UI fields are hidden)
        try {
            val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
            val v = prefs.getString(KEY_DRIVER_ID, "") ?: ""
            val n = try { normalizeUuid(v) } catch (_: Exception) { v.trim() }
            if (n.isNotBlank()) return n
        } catch (_: Exception) { }

        // Fallback to UI field if present
        return try {
            val raw = editDriverUuid.text?.toString() ?: ""
            val n = try { normalizeUuid(raw) } catch (_: Exception) { raw.trim() }
            n
        } catch (_: Exception) { "" }
    }

    private fun jridePollActiveTripOnce() {
        runOnUiThread { jrideSetLastSyncLabelNow("poll") }
        // === JRIDE_LASTSYNC_HEARTBEAT_V1 ===
        // Update "Last sync" even when there is no trip, so dispatcher can trust driver is polling.
        try {
            val now = System.currentTimeMillis()
            lastActiveTripSyncTs = now
            prefs().edit().putLong(KEY_DIAG_LAST_ACTIVE_AT, now).apply()
            runOnUiThread {
                try { renderLastSyncLabel() } catch (_: Exception) { }
                try { renderDiagnostics() } catch (_: Exception) { }
            }
        } catch (_: Exception) { }
        runOnUiThread { jrideUpdateLastSyncNow() }
    jrideUpdateLastSyncNow()
        val driverId = jrideGetDriverUuidForPoll()
        if (driverId.isBlank()) return
        if (!jrideShouldPollActiveTrip()) return

        val base = "https://app.jride.net"
        val urlStr = base + "/api/driver/active-trip?driver_id=" + java.net.URLEncoder.encode(driverId, "UTF-8")

        kotlin.concurrent.thread(start = true) {
            var newTripId: String? = null
            var tripStatus: String? = null
            var bookingCode: String? = null
            var note: String? = null
            var tripJson: String? = null

            try {
                val u = java.net.URL(urlStr)
                val conn = (u.openConnection() as java.net.HttpURLConnection).apply {
                    connectTimeout = 7000
                    readTimeout = 7000
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/json")
                }
                val code = conn.responseCode
                val body = try {
                    val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                    stream.bufferedReader().use { it.readText() }
                } catch (_: Exception) { "" }

                if (code in 200..299 && body.isNotBlank()) {
                    val root = org.json.JSONObject(body)
                    note = root.optString("note", null)

                    val tripObj =
                        root.optJSONObject("trip")
                            ?: root.optJSONObject("booking")
                            ?: root.optJSONObject("data")

                    if (tripObj != null) {
                        try { tripJson = tripObj.toString() } catch (_: Exception) { tripJson = null }
                        newTripId = tripObj.optString("id", null)
                        tripStatus = tripObj.optString("status", null)

                        // booking_code may be absent; fallback to code or id (so popup isn't always "-")
                        val bc1 = tripObj.optString("booking_code", null)
                        val bc2 = tripObj.optString("code", null)
                        bookingCode = if (!bc1.isNullOrBlank()) bc1 else if (!bc2.isNullOrBlank()) bc2 else newTripId
                    } else {
                        tripJson = null
                    }}
            } catch (_: Exception) { }

            // Sync UI state: set/clear activeTrip based on server response
            runOnUiThread {
                try {
                    if (tripJson.isNullOrBlank()) {
                        if (activeTrip != null) {
                            activeTrip = null
                            renderActiveTrip()
                        } else {
                            // ensure UI is consistent
                            renderActiveTrip()
                        }
                    } else {
                        activeTrip = try { org.json.JSONObject(tripJson) } catch (_: Exception) { null }
                        renderActiveTrip()
                    }
                } catch (_: Exception) { }
            }

            if (!newTripId.isNullOrBlank()) {
                runOnUiThread {
                    val tid = newTripId ?: return@runOnUiThread

                    // [JRIDE_GATING_V3] Single authoritative popup gate:
                    // must be ONLINE + SAVED and must be a new trip (prefs-deduped)
                    if (!jrideTryTripPopupGate(tid)) return@runOnUiThread

                    try { toast("New trip assigned!") } catch (_: Exception) { }
                    val msg =
                        "Status: " + (tripStatus ?: "-") + "\n" +
                        "Trip ID: " + (tid) + "\n" +
                        "Code: " + (bookingCode ?: "-") + "\n" +
                        "Note: " + (note ?: "-")

                    try {
                        android.app.AlertDialog.Builder(this@MainActivity)
                            .setTitle("JRIDE - New Trip")
                            .setMessage(msg)
                            .setPositiveButton("OK") { _, _ ->
                                try { renderActiveTrip() } catch (_: Exception) { }
                            }
                            .show()
                    } catch (_: Exception) { }
                }
            }
        }
    }
    // === JRIDE_ACTIVE_TRIP_POLL_PREFS_V10_END ===

    // === JRIDE_LAST_ACTIVE_FIELDS_V9_BEGIN ===
    // These fields are referenced elsewhere in MainActivity (UI/status/debug), so they must exist.
    private var lastActiveTripNote: String? = null
    private var lastActiveTripSyncTs: Long = 0L
    // === JRIDE_LAST_ACTIVE_FIELDS_V9_END ===


    private lateinit var textTitle: TextView
    private lateinit var textWelcome: TextView
    private lateinit var textStatus: TextView
    private lateinit var textHint: TextView
    private lateinit var textDriverIdShort: TextView
    private lateinit var textWalletBalance: TextView
    private lateinit var textWalletMin: TextView
    private lateinit var textWalletLocked: TextView


    private lateinit var textLastSync: TextView
    private lateinit var textDiag: TextView
    private lateinit var btnForceSync: Button
    private lateinit var panelActiveTrip: LinearLayout
    private lateinit var textTripStatus: TextView
    private lateinit var textTripPickup: TextView
    private lateinit var textTripDropoff: TextView
    private lateinit var textTripCode: TextView
    private lateinit var textTripFareState: TextView
    private lateinit var btnTripAccept: Button
    private lateinit var btnTripReject: Button
    private lateinit var btnTripCancel: Button
    private lateinit var btnTripComplete: Button
    private lateinit var btnTripStart: Button
    private lateinit var btnTripArrived: Button
    private lateinit var btnTripOnTheWay: Button
    private lateinit var rowTripLifecycle: android.widget.LinearLayout
    private lateinit var btnTripSms: Button
    private lateinit var btnTripCall: Button
    private lateinit var btnTripNav: Button
    private lateinit var btnTripProposeFare: Button

    private lateinit var btnGoOnline: Button
    private lateinit var btnWalkIn: Button
    private lateinit var btnChangeDevice: Button
    private lateinit var btnSave: Button

    private lateinit var editName: EditText
    private lateinit var editDriverUuid: EditText
    private lateinit var editTown: EditText

    private var deviceId16: String = "unknown"

        private var jrideAutoNavKey: String? = null

private var activeTrip: JSONObject? = null
    private var nudgeWatcher: DriverNudgeWatcher? = null

    companion object {
    // ---- JRIDE: Active trip gating keys ----
    private const val KEY_DRIVER_ID_SAVED = "driver_id_saved"
    private const val KEY_LAST_SEEN_TRIP_ID = "last_seen_trip_id"
    private const val KEY_ACTIVE_TRIP_JSON = "active_trip_json"
        private const val PREFS = "jride_driver_prefs"
        private const val KEY_NAME = "driver_name"
        private const val KEY_DRIVER_ID = "driver_uuid"
        private const val KEY_TOWN = "driver_town"
        private const val KEY_MODE = "mode"
                private const val KEY_DEVICE_ID16 = "device_id16_override"
        private const val KEY_BATT_WARNED = "batt_warned"

        // Diagnostics (ActiveTrip polling)
        private const val KEY_DIAG_LAST_ACTIVE_AT = "diag_last_active_at"
        private const val KEY_DIAG_LAST_ACTIVE_HTTP = "diag_last_active_http"
        private const val KEY_DIAG_LAST_ACTIVE_NOTE = "diag_last_active_note"
        private const val KEY_DIAG_LAST_ACTIVE_TRIPID = "diag_last_active_tripid"
    }

    private val activeTripReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != LocationUpdateService.ACTION_ACTIVE_TRIP_UPDATE) return
                        val ok = intent.getBooleanExtra(LocationUpdateService.EXTRA_OK, false)
            val note = intent.getStringExtra(LocationUpdateService.EXTRA_NOTE)
            val syncTs = intent.getLongExtra(LocationUpdateService.EXTRA_SYNC_TS, 0L)
            lastActiveTripNote = note
            lastActiveTripSyncTs = syncTs
            val tripJson = intent.getStringExtra(LocationUpdateService.EXTRA_TRIP_JSON)
            activeTrip = if (ok && !tripJson.isNullOrBlank()) {
                try { JSONObject(tripJson) } catch (_: Exception) { null }
            } else null
            renderActiveTrip()
            renderLastSyncLabel()
            renderDiagnostics()        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // === JRIDE_SAFE_AREA_INSETS_V1 ===
        // Add bottom padding equal to system bars so bottom buttons remain tappable.
        try {
            val rootScroll = findViewById<android.view.View>(R.id.root)
            ViewCompat.setOnApplyWindowInsetsListener(rootScroll) { v, insets ->
                val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars())
                v.updatePadding(bottom = sys.bottom + 120)
                insets
            }
        } catch (_: Exception) { }
    // === JRIDE: Safe-area padding so bottom Diagnostics/Force Sync is clickable on phones ===
    try {
      val rootScroll = findViewById<android.view.View>(R.id.root)
      ViewCompat.setOnApplyWindowInsetsListener(rootScroll) { v, insets ->
        val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        v.updatePadding(bottom = sys.bottom)
        insets
      }
    } catch (_: Throwable) { /* ignore */ }
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        
        // === JRIDE_ROLE_SELECT_RESTORE_V1 ===
        // If opened from launcher and no driver UUID saved, go to RoleSelect first.
        // RoleSelect -> Driver passes from_role_select=true to prevent looping.
        try {
            val fromRole = intent?.getBooleanExtra("from_role_select", false) ?: false
            if (!fromRole) {
                val savedDid = (prefs.getString(KEY_DRIVER_ID, "") ?: "").trim()
                if (savedDid.isBlank()) {
                    startActivity(Intent(this, RoleSelectActivity::class.java))
                    finish()
                    return
                }
            }
        } catch (_: Exception) { }
        // === JRIDE_ROLE_SELECT_RESTORE_V1_END ===
val overrideDev = prefs.getString(KEY_DEVICE_ID16, "") ?: ""
        deviceId16 = if (overrideDev.isNotBlank()) overrideDev else safeGetStableDeviceId16()

        bindUI()
        restoreUiFromPrefs()
        // === JRIDE_KEYBOARD_SCROLL_V1 ===
        // When keyboard opens, ensure the focused field is visible by scrolling the root ScrollView.
        try {
            val rootScroll = findViewById<android.widget.ScrollView>(R.id.root)
            val hook: (android.view.View) -> Unit = { v ->
                v.setOnFocusChangeListener { view, hasFocus ->
                    if (hasFocus) {
                        rootScroll.post {
                            try { rootScroll.smoothScrollTo(0, view.bottom + 120) } catch (_: Exception) { }
                        }
                    }
                }
            }
            hook(editName)
            hook(editDriverUuid)
            hook(editTown)
        } catch (_: Exception) { }
                ensureLocationPermission()
        requestPostNotificationsPermission()

        val m = getMode()
        if (m != "online" && m != "walkin" && m != "offline") setMode("offline")

        btnSave.setOnClickListener { onSaveTapped() }
        btnGoOnline.setOnClickListener { onGoOnlineTapped() }
        btnWalkIn.setOnClickListener { onWalkInTapped() }

        // Safer Change Device: hidden by default; long-press title to reveal for 60s
        btnChangeDevice.visibility = View.GONE
        btnChangeDevice.setOnClickListener { onChangeDeviceTapped() }
        textTitle.setOnLongClickListener {
            btnChangeDevice.visibility = View.VISIBLE
            toast("Admin unlock: Change Device enabled for 60 seconds.")
            textTitle.postDelayed({ btnChangeDevice.visibility = View.GONE }, 60_000)
            true
        }

                btnTripAccept.setOnClickListener { onAcceptTrip() }
        btnTripReject.setOnClickListener { onRejectTrip() }

        btnTripNav.setOnClickListener { try { jrideOpenNavToActiveTrip() } catch (_: Exception) { toast("NAV failed.") } }
        btnTripCall.setOnClickListener { try { jrideTryCallPassenger() } catch (_: Exception) { toast("CALL failed.") } }
        btnTripSms.setOnClickListener { try { jrideTrySmsPassenger() } catch (_: Exception) { toast("SMS failed.") } }

        btnTripOnTheWay.setOnClickListener { jrideLifecycleStub("on_the_way") }
        btnTripArrived.setOnClickListener { jrideLifecycleStub("arrived") }
        btnTripStart.setOnClickListener { jrideLifecycleStub("start_trip") }
        btnTripComplete.setOnClickListener { jrideLifecycleStub("complete_trip") }
        btnTripCancel.setOnClickListener { jrideLifecycleStub("cancel_trip") }


        btnTripProposeFare.setOnClickListener {
            try { jridePromptFareOfferAndSubmit() } catch (_: Exception) { toast("Fare offer failed.") }
        }

        // Hidden debug panel: long-press STATUS
        textStatus.setOnLongClickListener {
            showDebugPanel()
            true
        }

        refreshUi()
        renderActiveTrip()
    }

    override fun onStart() {
        super.onStart()
        try {
            val filter = IntentFilter(LocationUpdateService.ACTION_ACTIVE_TRIP_UPDATE)
if (Build.VERSION.SDK_INT >= 33) {
    registerReceiver(activeTripReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
} else {
    registerReceiver(activeTripReceiver, filter)
}} catch (_: Exception) {}
    }

    override fun onStop() {
        try { unregisterReceiver(activeTripReceiver) } catch (_: Exception) {}
        super.onStop()
    }

    private fun safeGetStableDeviceId16(): String =
        try { JRideDeviceId.get(this) } catch (_: Exception) { "unknown" }

    private fun bindUI() {
        textTitle = findViewById(R.id.text_title)
        textWelcome = findViewById(R.id.text_welcome)
        textStatus = findViewById(R.id.text_mode)
        textHint = findViewById(R.id.text_hint)
        textDriverIdShort = findViewById(R.id.text_driver_id_short)
        textWalletBalance = findViewById(R.id.text_wallet_balance)
        textWalletMin = findViewById(R.id.text_wallet_min)
        textWalletLocked = findViewById(R.id.text_wallet_locked)

        panelActiveTrip = findViewById(R.id.panel_active_trip)
        textTripStatus = findViewById(R.id.text_trip_status)
        textTripPickup = findViewById(R.id.text_trip_pickup)
        textTripDropoff = findViewById(R.id.text_trip_dropoff)
        textTripCode = findViewById(R.id.text_trip_code)
        textTripFareState = findViewById(R.id.text_trip_fare_state)
        btnTripAccept = findViewById(R.id.btn_trip_accept)
        btnTripReject = findViewById(R.id.btn_trip_reject)
        btnTripCancel = findViewById(R.id.btn_trip_cancel)
        btnTripComplete = findViewById(R.id.btn_trip_complete)
        btnTripStart = findViewById(R.id.btn_trip_start)
        btnTripArrived = findViewById(R.id.btn_trip_arrived)
        btnTripOnTheWay = findViewById(R.id.btn_trip_on_the_way)
        rowTripLifecycle = findViewById(R.id.row_trip_lifecycle)
        btnTripSms = findViewById(R.id.btn_trip_sms)
        btnTripCall = findViewById(R.id.btn_trip_call)
        btnTripNav = findViewById(R.id.btn_trip_nav)
        btnTripProposeFare = findViewById(R.id.btn_trip_propose_fare)

        btnGoOnline = findViewById(R.id.btn_primary)
        btnWalkIn = findViewById(R.id.btn_walkin)
        btnChangeDevice = findViewById(R.id.btn_change_device)
        btnSave = findViewById(R.id.btn_save)

        editName = findViewById(R.id.edit_driver_name)
        editDriverUuid = findViewById(R.id.edit_driver_id)
        editTown = findViewById(R.id.edit_town)

        // Diagnostics (always visible)
        textLastSync = findViewById(R.id.text_last_sync)
        textDiag = findViewById(R.id.text_diag)
        btnForceSync = findViewById(R.id.btn_force_sync)

        btnForceSync.setOnClickListener {
            runOnUiThread { jrideSetLastSyncLabelNow("force") }
            // === JRIDE_FORCE_SYNC_HEARTBEAT_V1 ===
            try {
                val now = System.currentTimeMillis()
                lastActiveTripSyncTs = now
                prefs().edit().putLong(KEY_DIAG_LAST_ACTIVE_AT, now).apply()
                runOnUiThread {
                    try { renderLastSyncLabel() } catch (_: Exception) { }
                    try { renderDiagnostics() } catch (_: Exception) { }
                }
            } catch (_: Exception) { }
            runOnUiThread { jrideUpdateLastSyncNow() }
            try {
                toast("Syncing active trip...")
                jridePollActiveTripOnce()
            } catch (_: Exception) {
                toast("Force sync failed.")
            }
        }
    }

    private fun prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun restoreUiFromPrefs() {
        val p = prefs()
        editName.setText(p.getString(KEY_NAME, "") ?: "")
        editDriverUuid.setText(p.getString(KEY_DRIVER_ID, "") ?: "")
        editTown.setText(p.getString(KEY_TOWN, "") ?: "")
        val nm = (editName.text?.toString() ?: "").trim()
        textWelcome.text = if (nm.isNotBlank()) "Welcome, $nm" else "Welcome, Driver"
    }

    private fun setMode(mode: String) {
        prefs().edit().putString(KEY_MODE, mode).apply()
    }

    private fun getMode(): String =
        (prefs().getString(KEY_MODE, "offline") ?: "offline").trim().lowercase(Locale.US)

    private fun onSaveTapped() {
        val nm = editName.text?.toString()?.trim() ?: ""
        val did = normalizeUuid(editDriverUuid.text?.toString() ?: "")
        val twn = (editTown.text?.toString() ?: "").trim()

        prefs().edit()
            .putString(KEY_NAME, nm)
            .putString(KEY_DRIVER_ID, did)
            .putString(KEY_TOWN, twn)
            .apply()

        // [JRIDE_GATING] mark whether UUID was explicitly saved
        jrideSetDriverIdSaved(did.isNotBlank())

        textWelcome.text = if (nm.isNotBlank()) "Welcome, $nm" else "Welcome, Driver"
        toast("Saved.")
        // === AUTOFILL_NAME_ON_SAVE_V2_BEGIN ===
        // If name is blank but UUID is set, auto-fetch name from Supabase (best-effort)
        if (nm.isBlank() && did.isNotBlank()) {
            DriverProfileRepository.fetchDriverNameById(did) { fetched ->
                if (!fetched.isNullOrBlank()) {
                    runOnUiThread {
                        try {
                            val clean = fetched.trim()
                            if (clean.isNotBlank()) {
                                editName.setText(clean)
                                textWelcome.text = "Welcome, $clean"
                                prefs().edit().putString(KEY_NAME, clean).apply()
                            }
                        } catch (_: Exception) { }
                    }
                }
            }
        }
        // === AUTOFILL_NAME_ON_SAVE_V2_END ===
        refreshUi()
    }

    private fun onChangeDeviceTapped() {
        val newDev = randomHex16()
        deviceId16 = newDev
        prefs().edit().putString(KEY_DEVICE_ID16, newDev).apply()
        toast("Device ID changed: $newDev")
        refreshUi()
    }

    private fun onGoOnlineTapped() {
        val mode = getMode()
        val driverId = normalizeUuid(editDriverUuid.text?.toString() ?: "")
        val town = (editTown.text?.toString() ?: "").trim()

        if (driverId.isBlank()) { toast("Enter Driver UUID then Save."); return }
if (mode == "online") {
            stopLocationService()
            setMode("offline")
            stopNudge()
            toast("OFFLINE")
        } else {
            startLocationService(driverId, town, "online")
            setMode("online")
            startNudge(driverId)
            toast("GO ONLINE started.")
        }

        refreshUi()
    }

    private fun onWalkInTapped() {
        val mode = getMode()
        val driverId = normalizeUuid(editDriverUuid.text?.toString() ?: "")
        val town = (editTown.text?.toString() ?: "").trim()

        if (driverId.isBlank()) { toast("Enter Driver UUID then Save."); return }
if (mode == "walkin") {
            stopLocationService()
            setMode("offline")
            stopNudge()
            toast("WALK-IN stopped.")
        } else {
            startLocationService(driverId, town, "walkin")
            setMode("walkin")
            startNudge(driverId)
            toast("WALK-IN started.")
        }

        refreshUi()
    }

    private fun startNudge(driverId: String) {
        if (nudgeWatcher != null) return
        nudgeWatcher = DriverNudgeWatcher(
            context = this,
            driverId = driverId,
            onNudge = {
                // Fast-path: on nudge, request active trip once
                LiveLocationClient.fetchActiveTripAsync(driverId) { ok, _, trip ->
                    runOnUiThread {
                        activeTrip = if (ok) trip else null
                        renderActiveTrip()
                    }
                }
            }
        )
        nudgeWatcher?.start()
    }

    private fun stopNudge() {
        nudgeWatcher?.stop()
        nudgeWatcher = null
    }

    private fun startLocationService(driverId: String, town: String, status: String) {
        val intent = Intent(this, LocationUpdateService::class.java).apply {
            action = LocationUpdateService.ACTION_START
            putExtra(LocationUpdateService.EXTRA_DRIVER_ID, driverId)
            putExtra(LocationUpdateService.EXTRA_TOWN, town)
            putExtra(LocationUpdateService.EXTRA_STATUS, status)
            putExtra(LocationUpdateService.EXTRA_DEVICE_ID, deviceId16)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(this, intent)
        } else {
            startService(intent)
        }
    }

    private fun stopLocationService() {
        val intent = Intent(this, LocationUpdateService::class.java).apply {
            action = LocationUpdateService.ACTION_STOP
        }
        startService(intent)
    }

        private fun jrideOpenNavToActiveTrip() {
        val trip = activeTrip
        if (trip == null) { toast("No active trip."); return }

        val plat = trip.optDouble("pickup_lat", Double.NaN)
        val plng = trip.optDouble("pickup_lng", Double.NaN)
        val dlat = trip.optDouble("dropoff_lat", Double.NaN)
        val dlng = trip.optDouble("dropoff_lng", Double.NaN)

        if (java.lang.Double.isNaN(plat) || java.lang.Double.isNaN(plng) || java.lang.Double.isNaN(dlat) || java.lang.Double.isNaN(dlng)) {
            toast("Missing pickup/dropoff coords.")
            return
        }

        try {
            val uri = android.net.Uri.parse("https://www.google.com/maps/dir/?api=1&origin=$plat,$plng&destination=$dlat,$dlng&travelmode=driving")
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, uri)
            intent.setPackage("com.google.android.apps.maps")
            startActivity(intent)
        } catch (_: Exception) {
            try {
                val uri2 = android.net.Uri.parse("geo:0,0?q=$dlat,$dlng")
                startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, uri2))
            } catch (_: Exception) {
                toast("No maps app found.")
            }
        }
    }

    private fun jrideTryCallPassenger() {
        val trip = activeTrip ?: run { toast("No active trip."); return }
        val phone = (trip.optString("passenger_phone", "") ?: "").trim()
        if (phone.isBlank()) { toast("Passenger phone not available."); return }
        try {
            val uri = android.net.Uri.parse("tel:$phone")
            startActivity(android.content.Intent(android.content.Intent.ACTION_DIAL, uri))
        } catch (_: Exception) { toast("Call failed.") }
    }

    private fun jrideTrySmsPassenger() {
        val trip = activeTrip ?: run { toast("No active trip."); return }
        val phone = (trip.optString("passenger_phone", "") ?: "").trim()
        if (phone.isBlank()) { toast("Passenger phone not available."); return }
        try {
            val uri = android.net.Uri.parse("smsto:$phone")
            val i = android.content.Intent(android.content.Intent.ACTION_SENDTO, uri)
            i.putExtra("sms_body", "JRide: driver here. On my way.")
            startActivity(i)
        } catch (_: Exception) { toast("SMS failed.") }
    }

    private fun jrideLifecycleStub(action: String) {
        // === JRIDE_LIFECYCLE_HTTP_V2_BEGIN ===
        // Canonical action keys: on_the_way, arrived, start_trip, complete_trip, cancel_trip
        val _key = action.trim().lowercase()

        val _t = activeTrip
        if (_t == null) {
            android.widget.Toast.makeText(this, "No active trip.", android.widget.Toast.LENGTH_SHORT).show()
            return
        }

        val _bookingId = _t.optString("id", null)
        val _bookingCode = _t.optString("booking_code", null)

        if (_bookingId.isNullOrBlank()) {
            android.widget.Toast.makeText(this, "Missing booking id.", android.widget.Toast.LENGTH_SHORT).show()
            return
        }

        val _allowed = setOf("on_the_way","arrived","start_trip","complete_trip","cancel_trip")
        if (!_allowed.contains(_key)) {
            android.widget.Toast.makeText(this, "Unknown action: $action", android.widget.Toast.LENGTH_SHORT).show()
            return
        }

        Thread {
            try {
                val _baseUrl = "https://app.jride.net"
                val _urlStr = _baseUrl.trimEnd('/') + "/api/driver/trip-lifecycle"

                val _payload = org.json.JSONObject()
                _payload.put("action", _key)
                _payload.put("booking_id", _bookingId)
                if (!_bookingCode.isNullOrBlank()) _payload.put("booking_code", _bookingCode)

                val _u = java.net.URL(_urlStr)
                val _conn = (_u.openConnection() as java.net.HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 15000
                    readTimeout = 15000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }

                _conn.outputStream.use { os ->
                    val bytes = _payload.toString().toByteArray(kotlin.text.Charsets.UTF_8)
                    os.write(bytes)
                }

                val _code = _conn.responseCode
                val _body = try {
                    val stream = if (_code in 200..299) _conn.inputStream else _conn.errorStream
                    stream?.bufferedReader()?.use { it.readText() } ?: ""
                } catch (_: Exception) { "" }

                runOnUiThread {
                    if (_code in 200..299) {
                        android.widget.Toast.makeText(this, "Status sent: $_key", android.widget.Toast.LENGTH_SHORT).show()
                    } else {
                        android.widget.Toast.makeText(this, "Lifecycle failed ($_code): " + _body.take(160), android.widget.Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    android.widget.Toast.makeText(this, "Lifecycle error: ${e.message}", android.widget.Toast.LENGTH_LONG).show()
                }
            }
        }.start()

        return
        // === JRIDE_LIFECYCLE_HTTP_V2_END ===

        val driverId = normalizeUuid(editDriverUuid.text?.toString() ?: "")
        if (driverId.isBlank()) {
            toast("Driver ID not set.")
            return
        }

        val trip = activeTrip
        if (trip == null) {
            toast("No active trip.")
            return
        }

        val bookingId = trip.optString("id", null)
        val bookingCode = trip.optString("booking_code", null)
        val st = (trip.optString("status", "") ?: "").trim().lowercase(Locale.US)

        // Block lifecycle transitions until passenger confirms fare
        val pfr = (trip.optString("passenger_fare_response", "") ?: "").trim().lowercase(Locale.US)
        val fareOk = (st == "ready") || (st == "fare_accepted" && pfr == "accepted")
        if (!fareOk) {
            toast("Waiting passenger fare confirmationâ€¦")
            return
        }

        val newStatus = when (action.trim().lowercase(Locale.US)) {
            "on_the_way" -> "on_the_way"
            "arrived" -> "arrived"
            "start_trip" -> "in_progress"
            "complete_trip" -> "completed"
            "cancel_trip" -> "cancelled"
            else -> ""
        }

        if (newStatus.isBlank()) {
            toast("Unknown action: ")
            return
        }

        // Disable buttons while sending
        btnTripOnTheWay.isEnabled = false
        btnTripArrived.isEnabled = false
        btnTripStart.isEnabled = false
        btnTripComplete.isEnabled = false
        btnTripCancel.isEnabled = false

        LiveLocationClient.updateTripStatusAsync(
            driverId = driverId,
            bookingId = bookingId,
            bookingCode = bookingCode,
            newStatus = newStatus
        ) { ok, msg ->
            runOnUiThread {
                // Re-enable
                btnTripOnTheWay.isEnabled = true
                btnTripArrived.isEnabled = true
                btnTripStart.isEnabled = true
                btnTripComplete.isEnabled = true
                btnTripCancel.isEnabled = true

                if (ok) {
                    toast("Status -> ")
                    try { trip.put("status", newStatus) } catch (_: Exception) {}
                    activeTrip = trip
                    renderActiveTrip()
                } else {
                    toast(msg ?: "Failed to update status.")
                }
            }
        }
    }

private fun renderActiveTrip() {
        val trip = activeTrip
        if (trip == null) {
            panelActiveTrip.visibility = View.GONE
            btnGoOnline.isEnabled = true
            btnWalkIn.isEnabled = true
            return
        }

        panelActiveTrip.visibility = View.VISIBLE

        val st = trip.optString("status", "-")
        // JRIDE_FARE_STATE_RENDER_BEGIN
        try {
            val stRaw = (trip.optString("status", "") ?: "").trim()
            val st2 = stRaw.lowercase(java.util.Locale.US)
            val resp = (trip.optString("passenger_fare_response", "") ?: "").trim().lowercase(java.util.Locale.US)

            val line =
                if (st2 == "fare_proposed") {
                    "Fare: Waiting for passenger response..."
                } else if (st2 == "fare_accepted" || (st2 == "ready" && resp == "accepted")) {
                    ""
                } else if (st2 == "ready" && resp == "declined") {
                    ""
                } else if (st2 == "accepted") {
                    "Fare: Propose a fare to continue."
                } else {
                    "Fare: -"
                }

            textTripFareState.text = line

            // Optional: auto-open NAV once when passenger accepted
            if (st2 == "ready" && resp == "accepted") {
                val codeKey = (trip.optString("booking_code", "") ?: "").trim()
                if (codeKey.isNotBlank() && jrideAutoNavKey != codeKey) {
                    jrideAutoNavKey = codeKey
                    try { jrideOpenNavToActiveTrip() } catch (_: Exception) { /* ignore */ }
                }
            }
        } catch (_: Exception) {
            textTripFareState.text = "Fare: -"
        }
        // JRIDE_FARE_STATE_RENDER_END

        // JRIDE_PROPOSE_FARE_VISIBILITY_BEGIN
        try {
            val stAny =
                try { trip.optString("status", "") }
                catch (e: Exception) {
                    try { trip.optString("status") } catch (e2: Exception) { "" }
                }
            val st = (stAny ?: "").trim().lowercase()

            // proposed/verified fare may be number or string; handle both
            val pfAny = try { trip.opt("proposed_fare") } catch (e: Exception) { null }
            val vfAny = try { trip.opt("verified_fare") } catch (e: Exception) { null }

            val hasPf =
                (pfAny != null) && (pfAny.toString().trim() != "") && (pfAny.toString().trim() != "null")
            val hasVf =
                (vfAny != null) && (vfAny.toString().trim() != "") && (vfAny.toString().trim() != "null")

            btnTripProposeFare.visibility =
                if (st == "accepted" && !hasPf && !hasVf) View.VISIBLE else View.GONE
        } catch (e: Exception) {
            btnTripProposeFare.visibility = View.GONE
        }
        // JRIDE_PROPOSE_FARE_VISIBILITY_END

        // JRIDE_READY_PROMPT_NAV_CALL_BEGIN
        try { jrideMaybePromptReadyNav(trip) } catch (_: Exception) { }
        // JRIDE_READY_PROMPT_NAV_CALL_END



        // Prefer labels; fallback to coords when labels are missing.
        var pickup = trip.optString("pickup_label", trip.optString("pickup", "-"))
        var dropoff = trip.optString("dropoff_label", trip.optString("dropoff", "-"))

        if (pickup.trim() == "-" || pickup.trim().isEmpty()) {
            val plat = trip.optDouble("pickup_lat", Double.NaN)
            val plng = trip.optDouble("pickup_lng", Double.NaN)
            if (!java.lang.Double.isNaN(plat) && !java.lang.Double.isNaN(plng)) {
                pickup = String.format(java.util.Locale.US, "%.6f, %.6f", plat, plng)
            }
        }

        if (dropoff.trim() == "-" || dropoff.trim().isEmpty()) {
            val dlat = trip.optDouble("dropoff_lat", Double.NaN)
            val dlng = trip.optDouble("dropoff_lng", Double.NaN)
            if (!java.lang.Double.isNaN(dlat) && !java.lang.Double.isNaN(dlng)) {
                dropoff = String.format(java.util.Locale.US, "%.6f, %.6f", dlat, dlng)
            }
        }

        val code = trip.optString("booking_code", trip.optString("code", trip.optString("id", "-")))

        textTripStatus.text = "Status: $st"
        textTripPickup.text = "Pickup: $pickup"
        textTripDropoff.text = "Dropoff: $dropoff"
        textTripCode.text = "Booking: $code"

                // JRIDE_LIFECYCLE_ROW_GATING_BEGIN
        try {
            val st2 = (trip.optString("status", "") ?: "").trim().lowercase(java.util.Locale.US)
            rowTripLifecycle.visibility =
                if (st2 == "assigned" || st2 == "accepted" || st2 == "fare_proposed") android.view.View.GONE else android.view.View.VISIBLE
        } catch (_: Exception) {
            rowTripLifecycle.visibility = android.view.View.GONE
        }
        // JRIDE_LIFECYCLE_ROW_GATING_END
btnGoOnline.isEnabled = false
        btnWalkIn.isEnabled = false

        val showDecision = st.trim().lowercase(Locale.US) == "assigned"
        btnTripAccept.visibility = if (showDecision) View.VISIBLE else View.GONE
        btnTripReject.visibility = if (showDecision) View.VISIBLE else View.GONE
    }

    private fun onAcceptTrip() {
        val driverId = normalizeUuid(editDriverUuid.text?.toString() ?: "")
        val trip = activeTrip ?: return

        val bookingId = trip.optString("id", null)
        val bookingCode = trip.optString("booking_code", null)

        btnTripAccept.isEnabled = false
        btnTripReject.isEnabled = false

        LiveLocationClient.updateTripStatusAsync(
            driverId = driverId,
            bookingId = bookingId,
            bookingCode = bookingCode,
            newStatus = "accepted"
        ) { ok, msg ->
            runOnUiThread {
                btnTripAccept.isEnabled = true
                btnTripReject.isEnabled = true
                if (ok) {
                    toast("Accepted.")
                    try { trip.put("status", "accepted") } catch (_: Exception) {}
                    activeTrip = trip
                    renderActiveTrip()
                    jridePromptFareOfferAndSubmit(driverId, bookingId, bookingCode)
                } else {
                    toast(msg ?: "Accept failed.")
                }
            }
        }
    }

    private fun onRejectTrip() {
        val driverId = normalizeUuid(editDriverUuid.text?.toString() ?: "")
        val trip = activeTrip ?: return

        val bookingId = trip.optString("id", null)
        val bookingCode = trip.optString("booking_code", null)

        btnTripAccept.isEnabled = false
        btnTripReject.isEnabled = false

        LiveLocationClient.updateTripStatusAsync(
            driverId = driverId,
            bookingId = bookingId,
            bookingCode = bookingCode,
            newStatus = "cancelled"
        ) { ok, msg ->
            runOnUiThread {
                btnTripAccept.isEnabled = true
                btnTripReject.isEnabled = true
                if (ok) {
                    toast("Rejected.")
                    activeTrip = null
                    renderActiveTrip()
                } else {
                    toast(msg ?: "Reject failed.")
                }
            }
        }
    }

    private fun refreshUi() {
        val driverId = normalizeUuid(editDriverUuid.text?.toString() ?: "")
        val town = (editTown.text?.toString() ?: "").trim()
        val mode = getMode()

        btnGoOnline.text = if (mode == "online") "GO OFFLINE" else "GO ONLINE"
        btnWalkIn.text = if (mode == "walkin") "STOP WALK-IN" else "START WALK-IN"

        val hintBase =
            if (driverId.isBlank()) {
                "Enter your Driver ID then tap Save."
            } else when (mode) {
                "offline" -> "Tap GO ONLINE when you're ready to accept trips.\nOr tap START WALK-IN if you already have a passenger."
                "online" -> "You are online and can receive trip requests."
                "walkin" -> "Walk-in mode active. Trips will be logged manually."
                else -> ""
            }

        val buildId = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "dev"
        } catch (_: Exception) { "dev" }

        textHint.text = checkBatteryOptimizationGuardrails("$hintBase\nBuild: $buildId\nDevice ID: $deviceId16 (len=${deviceId16.length})")

        textDriverIdShort.text =
            if (driverId.length >= 8) "Driver ID: ${driverId.take(8)}..." else "Driver ID: (not set)"

        val statusLabel = jrideComputeUiStatusLabel()
        textStatus.text = "STATUS: $statusLabel" + (if (town.isNotBlank()) " ($town)" else "") // [JRIDE_ENABLE_STATUS_LABEL_RENDER_V1]
        if (driverId.isNotBlank()) {
            LiveLocationClient.fetchWalletAsync(driverId) { ok, walletBalance, minRequired, locked, st, msg ->
                runOnUiThread {
                    if (ok) {
                        textWalletBalance.text = "Wallet Balance: PHP " + fmt2(walletBalance)
                        textWalletMin.text = "Min Required: PHP " + fmt2(minRequired)
                        textWalletLocked.text = "Wallet Status: " + (if (locked) "LOCKED" else "OK") +
                                (if (!st.isNullOrBlank()) " ($st)" else "")
                    } else {
                        textWalletBalance.text = "Wallet Balance: -"
                        textWalletMin.text = "Min Required: -"
                        textWalletLocked.text = "Wallet Status: -"
                        if (!msg.isNullOrBlank()) toast(msg)
                    }
                }
            }
        } else {
            textWalletBalance.text = "Wallet Balance: -"
            textWalletMin.text = "Min Required: -"
            textWalletLocked.text = "Wallet Status: -"
        }
    }

    private fun ensureLocationPermission() {
        val need = mutableListOf<String>()
        val fine = Manifest.permission.ACCESS_FINE_LOCATION
        val coarse = Manifest.permission.ACCESS_COARSE_LOCATION

        if (ContextCompat.checkSelfPermission(this, fine) != PackageManager.PERMISSION_GRANTED) need.add(fine)
        if (ContextCompat.checkSelfPermission(this, coarse) != PackageManager.PERMISSION_GRANTED) need.add(coarse)

        if (need.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, need.toTypedArray(), 101)
        }
    }

    private fun normalizeUuid(input: String): String =
        input.trim().lowercase(Locale.US)

    private fun randomHex16(): String {
        val bytes = ByteArray(8)
        java.security.SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { b -> "%02x".format(b) }
    }

    private fun fmt2(v: Double): String {
        val rounded = (v * 100.0).roundToInt() / 100.0
        return String.format(Locale.US, "%.2f", rounded)
    }

        private fun requestPostNotificationsPermission() {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                val perm = android.Manifest.permission.POST_NOTIFICATIONS
                if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(this, arrayOf(perm), 202)
                }
            }
        } catch (_: Exception) {}
    }

    private fun checkBatteryOptimizationGuardrails(hint: String): String {
        if (getMode() != "online") return hint
        return try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            val ignoring = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pm.isIgnoringBatteryOptimizations(packageName)
            } else true

            if (ignoring) hint else {
                val warned = prefs().getBoolean(KEY_BATT_WARNED, false)
                if (!warned) {
                    prefs().edit().putBoolean(KEY_BATT_WARNED, true).apply()
                    toast("Battery optimization is ON. It may stop background tracking/assignments. Long-press STATUS -> Debug.")
                }
                hint + "\n[WARN] Battery optimization ON. Long-press STATUS -> Battery settings."
            }
        } catch (_: Exception) { hint }
    }

    private fun openBatterySettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(i)
            } else {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        } catch (_: Exception) {
            try { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } catch (_: Exception) {}
        }
    }

    private fun showDebugPanel() {
        val driverId = normalizeUuid(editDriverUuid.text?.toString() ?: "")
        val town = (editTown.text?.toString() ?: "").trim()
        val mode = getMode()
        val buildId = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "dev" } catch (_: Exception) { "dev" }

        val trip = activeTrip
        val tripId = trip?.optString("id", "") ?: ""
        val tripCode = trip?.optString("booking_code", "") ?: ""
        val tripStatus = trip?.optString("status", "") ?: ""

        val note = lastActiveTripNote ?: "-"
        val ts = if (lastActiveTripSyncTs > 0L)
            java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(java.util.Date(lastActiveTripSyncTs))
        else "-"

        val msg =
            "Build: $buildId\n" +
            "Mode: $mode\n" +
            "Driver: " + (if (driverId.isBlank()) "(not set)" else driverId) + "\n" +
            "Town: " + (if (town.isBlank()) "(not set)" else town) + "\n" +
            "DeviceID: $deviceId16 (len=${deviceId16.length})\n\n" +
            "ActiveTrip: " + (if (trip == null) "NONE" else "YES") + "\n" +
            "TripStatus: " + (if (tripStatus.isBlank()) "-" else tripStatus) + "\n" +
            "TripId: " + (if (tripId.isBlank()) "-" else tripId) + "\n" +
            "TripCode: " + (if (tripCode.isBlank()) "-" else tripCode) + "\n\n" +
            "Last Poll Note: $note\n" +
            "Last Poll Sync: $ts\n\n" +
            "Actions:\n- OK = Close\n- Battery Settings = Fix background kill"

        AlertDialog.Builder(this)
            .setTitle("JRide Driver - Debug")
            .setMessage(msg)
            .setPositiveButton("OK", null)
            .setNeutralButton("Battery Settings") { _, _ -> openBatterySettings() }
            .show()
    }

        private fun renderLastSyncLabel() {
        try {
            val ts = if (lastActiveTripSyncTs > 0L)
                java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(java.util.Date(lastActiveTripSyncTs))
            else "-"
            textLastSync.text = "Last sync: $ts"
        } catch (_: Exception) { }
    }

    private fun renderDiagnostics() {
        try {
            val p = prefs()
            val at = p.getLong(KEY_DIAG_LAST_ACTIVE_AT, 0L)
            val http = p.getInt(KEY_DIAG_LAST_ACTIVE_HTTP, 0)
            val note = (p.getString(KEY_DIAG_LAST_ACTIVE_NOTE, "") ?: "").trim()
            val tripId = (p.getString(KEY_DIAG_LAST_ACTIVE_TRIPID, "") ?: "").trim()

            val ts = if (at > 0L)
                java.text.SimpleDateFormat("HH:mm:ss", Locale.US).format(java.util.Date(at))
            else "-"

            val httpTxt = if (http > 0) "$http" else "-"
            val tripTxt = if (tripId.isNotBlank()) tripId else "-"
            val noteTxt = if (note.isNotBlank()) note else "-"

            textDiag.text =
                "ActiveTrip HTTP: $httpTxt @ $ts\n" +
                "TripId: $tripTxt\n" +
                "Note: $noteTxt"
        } catch (_: Exception) { }
    }

private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    
  
    
    
    // === JRIDE_ACTIVE_TRIP_POLL_LOOP_V1 ===
    // Repeating poll loop (every 5s). Only executes polling when ONLINE + SAVED UUID.
    private val jridePollHandler = Handler(Looper.getMainLooper())
    private var jridePollLoopRunning = false
    private val jridePollLoopIntervalMs = 5000L

    private val jridePollLoopRunnable = object : Runnable {
        override fun run() {
            try {
                // NOTE: We always reschedule; execution is gated.
                try {
                    if (jrideShouldPollActiveTrip()) {
                        // This should increment your probe if you have it (POLL #n).
                        jridePollActiveTripOnce()
                    }
                } catch (_: Throwable) { }
            } finally {
                if (jridePollLoopRunning) {
                    jridePollHandler.postDelayed(this, jridePollLoopIntervalMs)
                }
            }
        }
    }

    private fun jrideStartPollLoop() {
        if (jridePollLoopRunning) return
        jridePollLoopRunning = true
        jridePollHandler.removeCallbacks(jridePollLoopRunnable)
        jridePollHandler.postDelayed(jridePollLoopRunnable, 1000L)
    }

    private fun jrideStopPollLoop() {
        jridePollLoopRunning = false
        jridePollHandler.removeCallbacks(jridePollLoopRunnable)
    }

// === JRIDE_POLL_PROBE_V1 ===
    private fun jrideProbe(tag: String) {
        try {
            val sdf = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
            val now = sdf.format(java.util.Date())
            val key = "JRIDE_PROBE_" + tag
            val n = (prefs().getInt(key, 0) + 1)
            prefs().edit().putInt(key, n).apply()
            val msg = tag + " #" + n + " @ " + now
            Log.d("JRIDE", msg)
            runOnUiThread {
                try {
                    // textStatus exists in your UI and is visible
                    // PROBE_UI_DISABLED: textStatus.text = msg
                } catch (_: Throwable) { }
            }
        } catch (_: Throwable) { }
    }

// === JRIDE_LASTSYNC_FORCE_LABEL_SAFE_V1 ===
    // Updates the "Last sync" label directly using the actual TextView id from activity_main.xml.
    private fun jrideSetLastSyncLabelNow(source: String) {
        try {
            val sdf = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
            val now = sdf.format(java.util.Date())
            val text = "Last sync: $now"
            try {
                val tv = findViewById<TextView>(R.id.text_last_sync)
                if (tv != null) tv.text = text
            } catch (_: Throwable) { }
        } catch (_: Throwable) { }
    }

private fun jrideUpdateLastSyncNow() {
    try {
      val sdf = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
      val now = sdf.format(java.util.Date())
      // textLastSync is assumed to exist in layout; guard if not
      try {
        textLastSync.text = "Last sync: $now"
      } catch (_: Throwable) { /* ignore */ }
    } catch (_: Throwable) { /* ignore */ }
  }
override fun onResume() {
        super.onResume()
        jrideStartPollLoop()
        // [JRIDE_GATING] Start/stop polling deterministically based on ONLINE + SAVED
        jrideApplyActiveTripPollingGate()
    }
    override fun onPause() {
        jrideStopActiveTripPolling()
        super.onPause()
    }


  // ---- JRIDE: Active trip gating helpers ----

  private fun jrideIsNewTrip(tripId: String): Boolean {
    val t = tripId.trim()
    if (t.isEmpty()) return false
    val last = jrideGetLastSeenTripId()
    return last != t
  }
  private fun jrideMarkTripSeen(tripId: String) {
    val t = tripId.trim()
    if (t.isNotEmpty()) jrideSetLastSeenTripId(t)
  }
  // [JRIDE_GATING_V3] Popup dedupe helper
  private fun jrideTryTripPopupGate(tripId: String): Boolean {
    if (!jrideShouldPollActiveTrip()) return false
    if (!jrideIsNewTrip(tripId)) return false
    jrideMarkTripSeen(tripId)
    return true
  }


  private fun jridePrefs() = getSharedPreferences(PREFS, MODE_PRIVATE)

  private fun jrideIsDriverIdSaved(): Boolean =
    jridePrefs().getBoolean(KEY_DRIVER_ID_SAVED, false)

  private fun jrideSetDriverIdSaved(saved: Boolean) {
    jridePrefs().edit().putBoolean(KEY_DRIVER_ID_SAVED, saved).apply()
  }

  private fun jrideGetLastSeenTripId(): String =
    jridePrefs().getString(KEY_LAST_SEEN_TRIP_ID, "") ?: ""

  private fun jrideSetLastSeenTripId(tripId: String) {
    jridePrefs().edit().putString(KEY_LAST_SEEN_TRIP_ID, tripId).apply()
  }

  private fun jrideStoreActiveTripJson(json: String) {
    jridePrefs().edit().putString(KEY_ACTIVE_TRIP_JSON, json).apply()
  }

  private fun jrideGetMode(): String =
    jridePrefs().getString(KEY_MODE, "")?.trim()?.lowercase() ?: ""

  private fun jrideIsOnlineMode(): Boolean =
    jrideGetMode() == "online" || jrideGetMode() == "available" || jrideGetMode() == "idle"

  // === JRIDE_STATUS_SINGLE_SOURCE_V1 ===
  private fun jrideComputeUiStatusLabel(): String {
      return if (jrideIsOnlineMode()) "ONLINE" else "OFFLINE"
  }

  private fun jrideShouldPollActiveTrip(): Boolean =
    jrideIsDriverIdSaved() && jrideIsOnlineMode()

  private fun jrideApplyActiveTripPollingGate() {
    if (jrideShouldPollActiveTrip()) {
      // Start polling only when gate is satisfied
      try { jrideStartActiveTripPolling() } catch (_: Throwable) {}
    } else {
      // Ensure polling is OFF when gate is not satisfied
      try { jrideStopActiveTripPolling() } catch (_: Throwable) {}
    }
  }


    // === JRIDE: Fare-offer prompt helper (injected) ===
    // NOTE: Using vararg keeps compatibility with any call signature.
    private fun jridePromptFareOfferAndSubmit(vararg args: Any?) {
        try {
            val trip = activeTrip
            if (trip == null) {
                toast("No active trip loaded.")
                return
            }

            val bookingId = trip.optString("id", "")
            val bookingCode = trip.optString("booking_code", "")
            val plat = trip.optDouble("pickup_lat", Double.NaN)
            val plng = trip.optDouble("pickup_lng", Double.NaN)
            val dlat = trip.optDouble("dropoff_lat", Double.NaN)
            val dlng = trip.optDouble("dropoff_lng", Double.NaN)

            val pickupStr =
                if (!java.lang.Double.isNaN(plat) && !java.lang.Double.isNaN(plng))
                    String.format(java.util.Locale.US, "%.6f, %.6f", plat, plng)
                else "(missing pickup coords)"

            val dropoffStr =
                if (!java.lang.Double.isNaN(dlat) && !java.lang.Double.isNaN(dlng))
                    String.format(java.util.Locale.US, "%.6f, %.6f", dlat, dlng)
                else "(missing dropoff coords)"

            val driverId = normalizeUuid(editDriverUuid.text?.toString() ?: "")
            val baseUrl = "https://app.jride.net"
            val convFee = 15

            val input = android.widget.EditText(this).apply {
                hint = "Enter fare (PHP) excluding PHP 15"
                inputType = android.text.InputType.TYPE_CLASS_NUMBER
            }

            val codeTxt = if (bookingCode.isNotBlank()) bookingCode else bookingId
            val msg =
                "Booking: $codeTxt\nPickup: $pickupStr\nDropoff: $dropoffStr\n\n" +
                "Enter your fare (excluding PHP 15). Passenger total = fare + PHP 15."

            AlertDialog.Builder(this)
                .setTitle("Fare Offer")
                .setMessage(msg)
                .setView(input)
                .setNeutralButton("OPEN ROUTE") { _, _ ->
                    try {
                        if (!java.lang.Double.isNaN(plat) && !java.lang.Double.isNaN(plng) &&
                            !java.lang.Double.isNaN(dlat) && !java.lang.Double.isNaN(dlng)
                        ) {
                            val gmaps = "https://www.google.com/maps/dir/?api=1&destination=$plat,$plng&travelmode=driving"
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(gmaps)))
                        } else {
                            toast("Missing coords, cannot open route.")
                        }
                    } catch (e: Exception) {
                        toast("Route open failed: " + (e.message ?: "unknown"))
                    }
                }
                .setNegativeButton("CANCEL", null)
                .setPositiveButton("SEND") { _, _ ->
                    val fareStr = (input.text?.toString() ?: "").trim()
                    val baseFare = try { fareStr.toInt() } catch (_: Exception) { 0 }
                    if (baseFare <= 0) {
                        toast("Invalid fare.")
                        return@setPositiveButton
                    }

                    val totalFare = baseFare + convFee
                    val url = baseUrl.trimEnd('/') + "/api/driver/fare-offer"

                    val body = org.json.JSONObject().apply {
                        put("driver_id", driverId)
                        if (bookingId.isNotBlank()) put("booking_id", bookingId)
                        if (bookingCode.isNotBlank()) put("booking_code", bookingCode)
                        put("proposed_fare", totalFare)
                        put("base_fare", baseFare)
                        put("convenience_fee", convFee)
                    }.toString()

                    toast("Sending offer...")

                    Thread {
                        try {
                            val u = java.net.URL(url)
                            val conn = (u.openConnection() as java.net.HttpURLConnection).apply {
                                requestMethod = "POST"
                                connectTimeout = 15000
                                readTimeout = 15000
                                doOutput = true
                                setRequestProperty("Content-Type", "application/json")
                                setRequestProperty("Accept", "application/json")
                            }
                            conn.outputStream.use { os ->
                                os.write(body.toByteArray(Charsets.UTF_8))
                            }
                            val code = conn.responseCode
                            runOnUiThread {
                                if (code in 200..299) {
                                    toast("Offer sent. Waiting passenger...")
                                    try { trip.put("proposed_fare", totalFare) } catch (_: Exception) {}
                                    try { trip.put("status", "fare_proposed") } catch (_: Exception) {}
                                    activeTrip = trip
                                    renderActiveTrip()
                                } else {
                                    toast("Offer failed: HTTP $code")
                                }
                            }
                        } catch (e: Exception) {
                            runOnUiThread { toast("Offer failed: " + (e.message ?: "unknown")) }
                        }
                    }.start()
                }
                .show()

        } catch (e: Exception) {
            toast("Fare offer error: " + (e.message ?: "unknown"))
        }
}


    // JRIDE_READY_PROMPT_NAV_BEGIN
    private fun jrideMaybePromptReadyNav(trip: org.json.JSONObject?) {
        if (trip == null) return

        val st = try { (trip.optString("status", "") ?: "").trim().lowercase() } catch (_: Exception) { "" }
        val pfr = try { (trip.optString("passenger_fare_response", "") ?: "").trim().lowercase() } catch (_: Exception) { "" }
        val code = try {
            val c = trip.optString("booking_code", "")
            if (!c.isNullOrBlank()) c else trip.optString("id", "")
        } catch (_: Exception) { "" }

        // Only when passenger accepted and trip is READY
        if (st != "ready" && st != "fare_accepted") return
if (st == "ready" && pfr != "accepted") return
        if (code.isNullOrBlank()) return

        val prefs = getSharedPreferences("jride_prefs", Context.MODE_PRIVATE)
        val lastCode = prefs.getString("jride_ready_prompt_last_code", "") ?: ""
        if (lastCode == code) return

        // Mark as shown immediately (prevents spam if render repeats)
        prefs.edit().putString("jride_ready_prompt_last_code", code).apply()

        runOnUiThread {
            try {
                AlertDialog.Builder(this)
                    .setTitle("Passenger accepted")
                    .setMessage("Fare accepted. Start navigation to pickup?")
                    .setPositiveButton("START NAV") { _, _ ->
                        try {
                            // Prefer clicking the existing NAV button (if wired)
                            val btnNav = try { findViewById<Button>(R.id.btn_trip_nav) } catch (_: Exception) { null }
                            if (btnNav != null) {
                                btnNav.performClick()
                                return@setPositiveButton
                            }
                        } catch (_: Exception) { }

                        // Fallback: open Google Maps to pickup destination
                        try {
                            val platAny = try { trip.opt("pickup_lat") } catch (_: Exception) { null }
                            val plngAny = try { trip.opt("pickup_lng") } catch (_: Exception) { null }
                            val plat = try { platAny.toString().toDouble() } catch (_: Exception) { Double.NaN }
                            val plng = try { plngAny.toString().toDouble() } catch (_: Exception) { Double.NaN }

                            if (!java.lang.Double.isNaN(plat) && !java.lang.Double.isNaN(plng)) {
                                val gmaps = "https://www.google.com/maps/dir/?api=1&destination=$plat,$plng&travelmode=driving"
                                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(gmaps)))
                            } else {
                                toast("Missing pickup coords.")
                            }
                        } catch (_: Exception) {
                            toast("Could not open navigation.")
                        }
                    }
                    .setNegativeButton("LATER", null)
                    .show()
            } catch (_: Exception) { }
        }
    }
    // JRIDE_READY_PROMPT_NAV_END

}














