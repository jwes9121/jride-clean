package com.jride.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject

class LocationUpdateService : Service() {

    companion object {
        private const val TAG = "LocationUpdateService"
        private const val CHANNEL_ID = "jride_location_channel"
        private const val ASSIGN_CHANNEL_ID = "jride_assignments_v3"
        private const val ASSIGN_NOTIF_ID = 1002
        private const val NOTIF_ID = 1001

        const val ACTION_START = "com.jride.app.LOC_START"
        const val ACTION_STOP  = "com.jride.app.LOC_STOP"

        const val EXTRA_DRIVER_ID = "driver_id"
        const val EXTRA_TOWN      = "town"
        const val EXTRA_STATUS    = "status"
        const val EXTRA_DEVICE_ID = "device_id"

        // Broadcast to Activity
        const val ACTION_ACTIVE_TRIP_UPDATE = "com.jride.app.ACTIVE_TRIP_UPDATE"
        const val EXTRA_OK = "ok"
        const val EXTRA_NOTE = "note"
        const val EXTRA_TRIP_JSON = "trip_json"
        const val EXTRA_SYNC_TS = "sync_ts"
    }

    private val PREFS_NAME = "jride_driver_prefs"
    private val PREF_DRIVER_ID = "driver_uuid"
    private val PREF_TOWN      = "driver_town"
    private val PREF_MODE      = "mode"
    private val PREF_DEVICE_ID = "device_id16_override"

    private val fused by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private val handler = Handler(Looper.getMainLooper())

    private var driverId: String = ""
    private var town: String? = null
    private var status: String = "offline"
    private var deviceId: String? = null

    private var activeTripPollRunning = false
    private var pollDelayMs = 4000L
    private var lastTripId: String? = null

    private var lastNotifText: String? = null

    // Server-sync tracking (prevents fake online)
    private var lastPingAttemptAtMs: Long = 0L
    private var lastPingOkAtMs: Long = 0L
    private var pingFailStreak: Int = 0
    private var lastPingCode: Int = 0

    private var lastAssignSoundAtMs: Long = 0L
    private val cb = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val loc: Location = result.lastLocation ?: return
            val lat = loc.latitude
            val lng = loc.longitude

            val did = driverId.trim()
            if (did.isBlank()) {
                Log.e(TAG, "ABORT ping: driverId blank. restoreFromPrefs()...")
                val ok = restoreFromPrefs()
                if (!ok) stopSelf()
                return
            }

            lastPingAttemptAtMs = System.currentTimeMillis()

LiveLocationClient.sendLocationAsync(
    driverId = did,
    lat = lat,
    lng = lng,
    status = status,
    town = town,
    deviceId = deviceId,
    onDone = { ok, body, code ->
        lastPingCode = code
        if (ok) {
            lastPingOkAtMs = System.currentTimeMillis()
            pingFailStreak = 0
        } else {
            pingFailStreak += 1
        }

        // Update notification on main thread (avoid fake online)
        handler.post {
            if (status == "online") {
                val now = System.currentTimeMillis()
                val ageSec = if (lastPingOkAtMs > 0L) ((now - lastPingOkAtMs) / 1000L) else 999999L

                val line =
                    if (ok) {
                        "Online (Server OK " + ageSec + "s) - Waiting for booking..."
                    } else {
                        "Online (Reconnecting... fail=" + pingFailStreak + " code=" + code + ")"
                    }

                updateNotification(line)
            }
        }
    }
)}
    }

        private var serverSyncWatchdogStarted = false

    private fun startServerSyncWatchdog() {
        if (serverSyncWatchdogStarted) return
        serverSyncWatchdogStarted = true

        val tick = object : Runnable {
            override fun run() {
                try {
                    if (status == "online") {
                        val now = System.currentTimeMillis()
                        val ageSec = if (lastPingOkAtMs > 0L) ((now - lastPingOkAtMs) / 1000L) else 999999L

                        if (ageSec >= 180L && ageSec < 999999L) {
                            updateNotification("Online (No server sync " + ageSec + "s) - Reconnecting...")
                        }
                    }
                } catch (_: Exception) { }
                handler.postDelayed(this, 15000L)
            }
        }

        handler.postDelayed(tick, 15000L)
    }
override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        Log.i(TAG, "onCreate()")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == null) {
            Log.w(TAG, "onStartCommand(): null action -> restoreFromPrefs()")
            val ok = restoreFromPrefs()
            if (!ok) stopSelf()
            return START_STICKY
        }

        when (intent.action) {
            ACTION_START -> {
                val did = (intent.getStringExtra(EXTRA_DRIVER_ID) ?: "").trim()
                val twn = intent.getStringExtra(EXTRA_TOWN)
                val st  = (intent.getStringExtra(EXTRA_STATUS) ?: "online").trim()
                val dev = (intent.getStringExtra(EXTRA_DEVICE_ID) ?: "").trim()

                if (did.isBlank()) {
                    Log.e(TAG, "ACTION_START refused: driverId blank")
                    stopSelf()
                    return START_NOT_STICKY
                }

                driverId = did
                town = twn
                status = if (st.isBlank()) "online" else st
                deviceId = if (dev.isBlank()) null else dev

                persistToPrefs()

                startForeground(NOTIF_ID, buildNotification(if (status == "online") "Online - Waiting for booking..." else "Walk-in active"))
                startUpdates()

                if (status == "online") startActiveTripPolling() else stopActiveTripPolling()
            }

            ACTION_STOP -> {
                Log.i(TAG, "ACTION_STOP")
                stopActiveTripPolling()
                stopUpdates()
                status = "offline"
                persistToPrefs()
                stopForeground(true)
                stopSelf()
            }

            else -> {
                Log.w(TAG, "Unknown action=${intent.action} -> restoreFromPrefs()")
                restoreFromPrefs()
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        Log.w(TAG, "onDestroy() removing updates")
        stopActiveTripPolling()
        stopUpdates()
        super.onDestroy()
    }

    private fun stopUpdates() {
        try { fused.removeLocationUpdates(cb) } catch (_: Exception) {}
    }

    private fun startUpdates() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) {
            Log.e(TAG, "Location permission NOT granted. Cannot start updates.")
            return
        }

        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000L)
            .setMinUpdateIntervalMillis(3000L)
            .build()

        fused.requestLocationUpdates(req, cb, Looper.getMainLooper())
    }

    private fun startActiveTripPolling() {
        if (activeTripPollRunning) return
        activeTripPollRunning = true
        pollDelayMs = 4000L
        lastTripId = null

        val tick = object : Runnable {
            override fun run() {
                if (!activeTripPollRunning) return

                val did = driverId.trim()
                if (did.isBlank() || status != "online") {
                    handler.postDelayed(this, 5000L)
                    return
                }

                LiveLocationClient.fetchActiveTripAsync(did) { ok, note, trip ->
                    try {
                        if (ok && trip != null) {
                            val tid = trip.optString("id", trip.optString("booking_code", ""))
                            if (tid.isNotBlank() && tid != lastTripId) {
                                lastTripId = tid
                                updateNotification("Assigned booking - Tap to open")
                                notifyAssignment()
                            }
                            broadcastTrip(true, note, trip)
                            pollDelayMs = 3000L
                        } else {
                            broadcastTrip(false, note, null)
                            updateNotification("Online - Waiting for booking...")
                            pollDelayMs = 5000L
                        }
                    } catch (_: Exception) {
                        pollDelayMs = 6000L
                    }
                }

                handler.postDelayed(this, pollDelayMs)
            }
        }

        handler.post(tick)
    }

    private fun stopActiveTripPolling() {
        activeTripPollRunning = false
        handler.removeCallbacksAndMessages(null)
        lastTripId = null
        pollDelayMs = 4000L
    }
    private fun broadcastTrip(ok: Boolean, note: String?, trip: JSONObject?) {
        try {
            val i = Intent(ACTION_ACTIVE_TRIP_UPDATE)
            i.putExtra(EXTRA_OK, ok)
            i.putExtra(EXTRA_SYNC_TS, System.currentTimeMillis())
            if (!note.isNullOrBlank()) i.putExtra(EXTRA_NOTE, note)
            if (trip != null) i.putExtra(EXTRA_TRIP_JSON, trip.toString())
            sendBroadcast(i)
        } catch (_: Exception) {}
    }

    private fun persistToPrefs() {
        try {
            val p = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            p.edit()
                .putString(PREF_DRIVER_ID, driverId)
                .putString(PREF_TOWN, town)
                .putString(PREF_MODE, status)
                .putString(PREF_DEVICE_ID, deviceId ?: "")
                .apply()
        } catch (e: Exception) {
            Log.e(TAG, "persistToPrefs() failed", e)
        }
    }

    private fun restoreFromPrefs(): Boolean {
        return try {
            val p = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val did = (p.getString(PREF_DRIVER_ID, "") ?: "").trim()
            val twn = p.getString(PREF_TOWN, null)
            val st  = (p.getString(PREF_MODE, "offline") ?: "offline").trim()
            val dev = (p.getString(PREF_DEVICE_ID, "") ?: "").trim()

            if (did.isBlank()) {
                false
            } else {
                driverId = did
                town = twn
                status = if (st.isBlank()) "offline" else st
                deviceId = if (dev.isBlank()) null else dev

                if (status == "online" || status == "walkin") {
                    startForeground(NOTIF_ID, buildNotification(if (status == "online") "Online - Waiting for booking..." else "Walk-in active"))
                    startUpdates()
                    if (status == "online") startActiveTripPolling()
                }
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun buildNotification(content: String): Notification {
        ensureChannel()

        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        )

        // IMPORTANT: Foreground ongoing notification must be SILENT/LOW importance
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("JRide Driver")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(content: String) {
        try {
            if (content == lastNotifText) return
            lastNotifText = content
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID, buildNotification(content))
        } catch (_: Exception) {}
    }

    private fun notifyAssignment() {
        try {
            ensureChannel()
            val openIntent = packageManager.getLaunchIntentForPackage(packageName)
            val pi = PendingIntent.getActivity(
                this,
                1,
                openIntent,
                (PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0))
            )

            val n = NotificationCompat.Builder(this, ASSIGN_CHANNEL_ID)
                .setContentTitle("JRide Driver")
                .setContentText("New booking assigned - Tap to open")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .build()

            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            // ===== JRIDE_ASSIGN_SOUND_ONCE_BEGIN =====
            // Play ONLY for new assignment notification (cooldown to prevent repeats)
            try {
                val now = System.currentTimeMillis()
                if (now - lastAssignSoundAtMs > 15000L) { // 15s cooldown
                    lastAssignSoundAtMs = now
                    val mp = android.media.MediaPlayer.create(this, R.raw.problem_trip_alert)
                    mp.setOnCompletionListener { it.release() }
                    mp.start()
                }
            } catch (_: Exception) { }
            // ===== JRIDE_ASSIGN_SOUND_ONCE_END =====
            nm.notify(ASSIGN_NOTIF_ID, n)
        } catch (_: Exception) {}
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val ch = NotificationChannel(CHANNEL_ID, "JRide Location", NotificationManager.IMPORTANCE_LOW)
        nm.createNotificationChannel(ch)

        val ach = NotificationChannel(ASSIGN_CHANNEL_ID, "JRide Assignments", NotificationManager.IMPORTANCE_HIGH).apply {
            enableVibration(true)

            // Custom sound from res/raw/problem_trip_alert.mp3 (channel sound)
            val soundUri = android.net.Uri.parse("android.resource://" + packageName + "/" + R.raw.problem_trip_alert)
            val aa = android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            setSound(soundUri, aa)
        }
        nm.createNotificationChannel(ach)
    }
}