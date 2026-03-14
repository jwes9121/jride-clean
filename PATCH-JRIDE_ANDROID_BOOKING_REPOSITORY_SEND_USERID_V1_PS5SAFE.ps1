param(
    [Parameter(Mandatory=$true)]
    [string]$AndroidRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE ANDROID BOOKING REPOSITORY SEND USERID V1 =="

$repoPath = Join-Path $AndroidRoot "app\src\main\java\com\jride\app\passenger\booking\BookingRepository.kt"
if (!(Test-Path $repoPath)) {
    throw "BookingRepository.kt not found: $repoPath"
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $AndroidRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item $repoPath (Join-Path $backupDir ("BookingRepository.kt.bak.SEND_USERID_V1.{0}" -f $timestamp)) -Force
Write-Host "[OK] Backup created"

$code = @'
package com.jride.app.passenger.booking

import android.util.Log
import com.jride.app.common.api.ApiClient
import com.jride.app.common.model.PassengerBooking
import org.json.JSONObject

class BookingRepository {

    data class CreateBookingRequest(
        val passengerName: String?,
        val town: String?,
        val vehicleType: String?,
        val passengerCount: Int?,
        val pickupLabel: String,
        val dropoffLabel: String,
        val pickupLat: Double?,
        val pickupLng: Double?,
        val dropoffLat: Double?,
        val dropoffLng: Double?,
        val notes: String?,
        val feesAcknowledged: Boolean,
        val passengerUserId: String?,
        val passengerPhone: String?
    )

    data class CreateBookingResult(
        val ok: Boolean,
        val booking: PassengerBooking?,
        val bookingCode: String?,
        val rawResponse: String?,
        val error: String?
    )

    fun submitBooking(request: CreateBookingRequest): CreateBookingResult {
        if (request.pickupLabel.isBlank()) {
            return CreateBookingResult(false, null, null, null, "Pickup is required.")
        }

        if (request.dropoffLabel.isBlank()) {
            return CreateBookingResult(false, null, null, null, "Dropoff is required.")
        }

        if (!request.feesAcknowledged) {
            return CreateBookingResult(false, null, null, null, "Please acknowledge the fare / fee notice first.")
        }

        val attempt = buildAttempt(request)

        try {
            Log.d("JRideBooking", "POST " + attempt.path)
            Log.d("JRideBooking", "BODY " + attempt.body.toString())

            val result = ApiClient.post(attempt.path, attempt.body)
            val raw = result.raw

            Log.d("JRideBooking", "HTTP ok=" + result.ok)
            Log.d("JRideBooking", "RAW " + (raw ?: ""))

            if (!result.ok) {
                return CreateBookingResult(
                    false,
                    null,
                    null,
                    raw,
                    "Passenger booking request failed for " + attempt.path
                )
            }

            val root = result.json
            if (root != null) {
                val bookingJson = extractBookingJson(root)
                if (bookingJson != null) {
                    val booking = PassengerBooking.fromJson(bookingJson)
                    val code = booking.bookingCode.ifBlank { null }
                    if (!code.isNullOrBlank()) {
                        return CreateBookingResult(true, booking, code, raw, null)
                    }
                }

                val directCode = firstNonBlank(
                    root,
                    arrayOf("booking_code", "bookingCode", "code")
                )

                if (!directCode.isNullOrBlank()) {
                    val synthetic = PassengerBooking(
                        id = firstNonBlank(root, arrayOf("id", "uuid")) ?: "",
                        bookingCode = directCode,
                        status = firstNonBlank(root, arrayOf("status")) ?: "pending",
                        town = request.town,
                        fromLabel = request.pickupLabel,
                        toLabel = request.dropoffLabel,
                        pickupLat = request.pickupLat,
                        pickupLng = request.pickupLng,
                        dropoffLat = request.dropoffLat,
                        dropoffLng = request.dropoffLng,
                        createdAt = null,
                        updatedAt = null,
                        assignedDriverId = null,
                        driverId = null,
                        proposedFare = null,
                        passengerFareResponse = null,
                        driverStatus = null,
                        customerStatus = null,
                        createdByUserId = request.passengerUserId
                    )
                    return CreateBookingResult(true, synthetic, directCode, raw, null)
                }
            }

            return CreateBookingResult(
                false,
                null,
                null,
                raw,
                "Passenger booking response did not include a booking code."
            )
        } catch (e: Exception) {
            Log.e("JRideBooking", "submitBooking failed", e)
            return CreateBookingResult(
                false,
                null,
                null,
                null,
                e.message ?: "Passenger booking request failed."
            )
        }
    }

    private data class Attempt(val path: String, val body: JSONObject)

    private fun buildAttempt(request: CreateBookingRequest): Attempt {
        val body = JSONObject().apply {
            put("role", "passenger")
            put("passenger_name", request.passengerName)
            put("full_name", request.passengerName)
            put("town", request.town)
            put("vehicle_type", request.vehicleType)
            put("passenger_count", request.passengerCount)
            put("pickup_label", request.pickupLabel)
            put("dropoff_label", request.dropoffLabel)
            put("pickup_lat", request.pickupLat)
            put("pickup_lng", request.pickupLng)
            put("dropoff_lat", request.dropoffLat)
            put("dropoff_lng", request.dropoffLng)
            put("notes", request.notes)
            put("fees_acknowledged", request.feesAcknowledged)

            val uid = request.passengerUserId?.trim().orEmpty()
            if (uid.isNotBlank()) {
                put("created_by_user_id", uid)
                put("user_id", uid)
            }

            val phone = request.passengerPhone?.trim().orEmpty()
            if (phone.isNotBlank()) {
                put("phone", phone)
            }
        }

        return Attempt("/api/public/passenger/booking", body)
    }

    private fun extractBookingJson(root: JSONObject): JSONObject? {
        val candidates = arrayOf("booking", "trip", "data", "ride")
        for (k in candidates) {
            val child = root.optJSONObject(k)
            if (child != null) {
                val nestedBooking = child.optJSONObject("booking")
                if (nestedBooking != null) return nestedBooking
                return child
            }
        }

        val rootLooksLikeBooking =
            root.has("booking_code") ||
            root.has("bookingCode") ||
            root.has("status") ||
            root.has("id")

        if (rootLooksLikeBooking) return root
        return null
    }

    private fun firstNonBlank(j: JSONObject, keys: Array<String>): String? {
        for (k in keys) {
            if (j.has(k) && !j.isNull(k)) {
                val v = j.optString(k, "")
                if (v.isNotBlank()) return v
            }
        }
        return null
    }
}
'@

Set-Content -LiteralPath $repoPath -Value $code -Encoding UTF8
Write-Host "[OK] Wrote BookingRepository.kt"
Write-Host ""
Write-Host "PATCH COMPLETE"
Write-Host "Modified file:"
Write-Host " - $repoPath"