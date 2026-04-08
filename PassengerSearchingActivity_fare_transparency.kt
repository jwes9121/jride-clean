package com.jride.app.passenger.trip

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.jride.app.R
import com.jride.app.common.model.PassengerBooking
import com.jride.app.passenger.booking.PassengerBookRideActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PassengerSearchingActivity : AppCompatActivity() {

    private lateinit var textTitle: TextView
    private lateinit var textSubtitle: TextView
    private lateinit var textBookingCode: TextView
    private lateinit var textStatus: TextView
    private lateinit var textStage: TextView
    private lateinit var textLastUpdated: TextView

    private lateinit var stepRequested: TextView
    private lateinit var stepAssigned: TextView
    private lateinit var stepOnTheWay: TextView
    private lateinit var stepArrived: TextView
    private lateinit var stepOnTrip: TextView
    private lateinit var stepCompleted: TextView

    private lateinit var cardTripSummary: LinearLayout
    private lateinit var textTown: TextView
    private lateinit var textPickup: TextView
    private lateinit var textDropoff: TextView
    private lateinit var textDriver: TextView
    private lateinit var textTripMetrics: TextView

    private lateinit var cardFare: LinearLayout
    private lateinit var textFareLabel: TextView
    private lateinit var textFareValue: TextView
    private lateinit var textFareResponse: TextView
    private lateinit var btnAcceptFare: Button
    private lateinit var btnRejectFare: Button

    private lateinit var textMsg: TextView
    private lateinit var btnBack: Button
    private lateinit var btnBookAnother: Button
    private lateinit var btnDone: Button

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var repository: PassengerTripRepository

    private var bookingCode: String = ""
    private var polling = false
    private var lastBooking: PassengerBooking? = null
    private var lastNormalizedStatus: String = "pending"

    private val mint = Color.parseColor("#49C9AF")
    private val mutedBg = Color.parseColor("#1F2937")
    private val mutedText = Color.parseColor("#94A3B8")
    private val white = Color.parseColor("#FFFFFF")

    private val pollRunnable = object : Runnable {
        override fun run() {
            if (!polling) return
            refreshStatus()
            handler.postDelayed(this, 3000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_passenger_searching)

        repository = PassengerTripRepository()

        textTitle = findViewById(R.id.text_title)
        textSubtitle = findViewById(R.id.text_subtitle)
        textBookingCode = findViewById(R.id.text_booking_code)
        textStatus = findViewById(R.id.text_status)
        textStage = findViewById(R.id.text_stage)
        textLastUpdated = findViewById(R.id.text_last_updated)

        stepRequested = findViewById(R.id.step_requested)
        stepAssigned = findViewById(R.id.step_assigned)
        stepOnTheWay = findViewById(R.id.step_on_the_way)
        stepArrived = findViewById(R.id.step_arrived)
        stepOnTrip = findViewById(R.id.step_on_trip)
        stepCompleted = findViewById(R.id.step_completed)

        cardTripSummary = findViewById(R.id.card_trip_summary)
        textTown = findViewById(R.id.text_town)
        textPickup = findViewById(R.id.text_pickup)
        textDropoff = findViewById(R.id.text_dropoff)
        textDriver = findViewById(R.id.text_driver)
        textTripMetrics = findViewById(R.id.text_trip_metrics)

        cardFare = findViewById(R.id.card_fare)
        textFareLabel = findViewById(R.id.text_fare_label)
        textFareValue = findViewById(R.id.text_fare_value)
        textFareResponse = findViewById(R.id.text_fare_response)
        btnAcceptFare = findViewById(R.id.btn_accept_fare)
        btnRejectFare = findViewById(R.id.btn_reject_fare)

        textMsg = findViewById(R.id.text_msg)
        btnBack = findViewById(R.id.btn_back)
        btnBookAnother = findViewById(R.id.btn_book_another)
        btnDone = findViewById(R.id.btn_done)

        bookingCode = intent.getStringExtra(EXTRA_BOOKING_CODE)?.trim().orEmpty()

        if (bookingCode.isBlank()) {
            textBookingCode.text = "Booking Code: -"
            textStatus.text = "Status: unavailable"
            textStage.text = "Stage: missing booking code"
            textSubtitle.text = "We could not load this booking."
            showMsg("Missing booking code.")
        } else {
            textBookingCode.text = "Booking Code: $bookingCode"
            textStatus.text = "Status: pending"
            textStage.text = "Stage: waiting for first status check"
            textSubtitle.text = "We are checking your booking every few seconds."
        }

        textLastUpdated.text = "Last updated: not yet checked"
        hideFareCard()
        hideCompletionButtons()
        renderSteps("pending")
        textTripMetrics.text = "Pickup: Waiting... | ETA: Waiting... | Trip: Waiting..."

        btnBack.setOnClickListener { finish() }
        btnAcceptFare.setOnClickListener { submitFareAction("accept") }
        btnRejectFare.setOnClickListener { submitFareAction("reject") }

        btnBookAnother.setOnClickListener {
            try {
                val intent = Intent(this, PassengerBookRideActivity::class.java)
                intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
                finish()
            } catch (_: Exception) {
                finish()
            }
        }

        btnDone.setOnClickListener { finish() }
    }

    override fun onStart() {
        super.onStart()
        polling = true
        handler.post(pollRunnable)
    }

    override fun onStop() {
        super.onStop()
        polling = false
        handler.removeCallbacks(pollRunnable)
    }

    private fun refreshStatus() {
        if (bookingCode.isBlank()) return

        textStatus.text = "Status: checking"

        Thread {
            val result = repository.getBookingStatus(bookingCode)

            runOnUiThread {
                textLastUpdated.text = "Last updated: " + nowStamp()

                if (result.ok && result.booking != null) {
                    lastBooking = result.booking
                    lastNormalizedStatus = normalizeStatus(result.booking.status)
                    renderBooking(result.booking)
                } else {
                    handleTrackFailure(result.error)
                }
            }
        }.start()
    }

    private fun handleTrackFailure(rawError: String?) {
        val err = rawError?.trim().orEmpty()

        if (isTerminalTrackError(err)) {
            renderTerminalFromLastKnownState()
            return
        }

        textStatus.text = "Status: unavailable"
        textStage.text = "Stage: track request failed"
        showMsg(err.ifBlank { "Unable to check booking status." })
    }

    private fun isTerminalTrackError(rawError: String?): Boolean {
        val e = rawError?.trim()?.uppercase(Locale.US).orEmpty()
        return e.contains("BOOKING_NOT_ACTIVE")
    }

    private fun renderTerminalFromLastKnownState() {
        stopPollingTerminal()
        renderSteps("completed")
        textStatus.text = "Status: completed"
        textStage.text = "Stage: completed"
        textTitle.text = "Trip Completed"
        textSubtitle.text = "Your trip has been completed successfully."
        showMsg("Trip completed. Thank you for using JRide!")
        showCompletionButtons()

        val booking = lastBooking
        if (booking != null) {
            textBookingCode.text = "Booking Code: " + booking.bookingCode.ifBlank { bookingCode.ifBlank { "-" } }
            textTown.text = "Town: " + cleanAddress(booking.town ?: "-")
            textPickup.text = "Pickup: " + cleanAddress(booking.fromLabel ?: "-")
            textDropoff.text = "Drop-off: " + cleanAddress(booking.toLabel ?: "-")

            val driverText = when {
                !booking.driverName.isNullOrBlank() -> booking.driverName
                !booking.driverId.isNullOrBlank() || !booking.assignedDriverId.isNullOrBlank() -> "Driver assigned (name unavailable)"
                else -> "-"
            }
            textDriver.text = "Driver: $driverText"
            textTripMetrics.text = buildMetricsText(booking, "completed")
            renderFareCard(booking, "completed")
        } else {
            textBookingCode.text = "Booking Code: " + bookingCode.ifBlank { "-" }
        }
    }

    private fun submitFareAction(action: String) {
        if (bookingCode.isBlank()) return

        btnAcceptFare.isEnabled = false
        btnRejectFare.isEnabled = false

        showMsg(
            if (action == "accept") {
                "Submitting fare acceptance..."
            } else {
                "Requesting a new driver..."
            }
        )

        Thread {
            val result = repository.respondToFare(bookingCode, action)

            runOnUiThread {
                btnAcceptFare.isEnabled = true
                btnRejectFare.isEnabled = true

                if (result.ok) {
                    showMsg(
                        if (action == "accept") {
                            "Fare accepted. Refreshing booking status."
                        } else {
                            "Fare rejected. Refreshing booking status."
                        }
                    )
                    refreshStatus()
                } else {
                    showMsg("Fare action failed: " + (result.error ?: "Unknown error"))
                }
            }
        }.start()
    }

    private fun renderBooking(booking: PassengerBooking) {
        val normalized = normalizeStatus(booking.status)

        textBookingCode.text = "Booking Code: " + booking.bookingCode.ifBlank { "-" }
        textStatus.text = "Status: $normalized"
        renderSteps(normalized)

        textTown.text = "Town: " + cleanAddress(booking.town ?: "-")
        textPickup.text = "Pickup: " + cleanAddress(booking.fromLabel ?: "-")
        textDropoff.text = "Drop-off: " + cleanAddress(booking.toLabel ?: "-")

        val driverText = when {
            !booking.driverName.isNullOrBlank() -> booking.driverName
            !booking.driverId.isNullOrBlank() || !booking.assignedDriverId.isNullOrBlank() -> "Driver assigned (name unavailable)"
            else -> "-"
        }

        textDriver.text = "Driver: $driverText"
        textTripMetrics.text = buildMetricsText(booking, normalized)

        renderFareCard(booking, normalized)

        when (normalized) {
            "pending" -> {
                textTitle.text = "Searching for Driver"
                textSubtitle.text = "Your booking has been received."
                textStage.text = "Stage: booking received"
                showMsg("JRIDE is still searching for an available driver.")
                hideCompletionButtons()
            }
            "assigned" -> {
                textTitle.text = "Driver Assigned"
                textSubtitle.text = "A driver has been assigned to your booking."
                textStage.text = "Stage: driver assigned"
                if (isWaitingForDriverProposal(booking)) {
                    showMsg("Waiting for driver fare proposal.")
                } else {
                    showMsg("We have assigned a driver to your booking.")
                }
                hideCompletionButtons()
            }
            "accepted" -> {
                textTitle.text = "Driver Accepted"
                textSubtitle.text = "Your assigned driver accepted the booking."
                textStage.text = "Stage: driver accepted"
                if (isWaitingForDriverProposal(booking)) {
                    showMsg("Waiting for driver fare proposal.")
                } else {
                    showMsg("Your assigned driver accepted the booking.")
                }
                hideCompletionButtons()
            }
            "fare_proposed" -> {
                textTitle.text = "Driver's Offer"
                textSubtitle.text = "Please review the fare before continuing."
                textStage.text = "Stage: fare review"
                showMsg("The driver sent a fare offer for your review.")
                hideCompletionButtons()
            }
            "ready" -> {
                textTitle.text = "Fare Confirmed"
                textSubtitle.text = "Your fare has been confirmed."
                textStage.text = "Stage: ready"
                showMsg("Your fare is confirmed. The trip is ready to continue.")
                hideCompletionButtons()
            }
            "on_the_way" -> {
                textTitle.text = "Driver On The Way"
                textSubtitle.text = "Your driver is heading to the pickup point."
                textStage.text = "Stage: approaching pickup"
                showMsg("Your driver is on the way to the pickup point.")
                hideCompletionButtons()
            }
            "arrived" -> {
                textTitle.text = "Driver Arrived"
                textSubtitle.text = "Your driver has arrived at the pickup point."
                textStage.text = "Stage: at pickup point"
                showMsg("Your driver has arrived at the pickup point.")
                hideCompletionButtons()
            }
            "on_trip" -> {
                textTitle.text = "Trip In Progress"
                textSubtitle.text = "You are now on your trip."
                textStage.text = "Stage: passenger onboard"
                showMsg("Your trip is currently in progress.")
                hideCompletionButtons()
            }
            "completed" -> {
                textTitle.text = "Trip Completed"
                textSubtitle.text = "Your trip has been completed successfully."
                textStage.text = "Stage: completed"
                showMsg("Trip completed. Thank you for using JRide!")
                stopPollingTerminal()
                showCompletionButtons()
            }
            "cancelled" -> {
                textTitle.text = "Trip Cancelled"
                textSubtitle.text = "This booking was cancelled."
                textStage.text = "Stage: cancelled"
                showMsg("Trip was cancelled.")
                stopPollingTerminal()
                showCompletionButtons()
            }
            else -> {
                textTitle.text = "Booking Update"
                textSubtitle.text = "We received a status update."
                textStage.text = "Stage: unknown status"
                showMsg("Received status: $normalized")
                hideCompletionButtons()
            }
        }
    }

    private fun renderFareCard(booking: PassengerBooking, normalized: String) {
        val waitingForDriverProposal = isWaitingForDriverProposal(booking)
        val fareReady = isFareReady(booking)
        val response = booking.passengerFareResponse?.trim()?.lowercase(Locale.ROOT)

        if (waitingForDriverProposal && !fareReady) {
            cardFare.visibility = View.VISIBLE
            textFareLabel.text = "Total fare"
            textFareValue.text = "Waiting for driver proposal"
            textFareResponse.text = "The driver has been assigned. Fare details will appear after the driver sends a proposal."
            btnAcceptFare.visibility = View.GONE
            btnRejectFare.visibility = View.GONE
            return
        }

        val proposedFare = booking.proposedFare
        val pickupDistanceFee = booking.pickupDistanceFee
        val totalFare = booking.totalFare ?: booking.verifiedFare ?: proposedFare

        val hasAnyFare = proposedFare != null || pickupDistanceFee != null || totalFare != null
        if (!hasAnyFare) {
            hideFareCard()
            return
        }

        cardFare.visibility = View.VISIBLE
        textFareLabel.text = "Total fare"
        textFareValue.text = formatMoney(totalFare ?: proposedFare)

        val breakdown = mutableListOf<String>()
        if (proposedFare != null) {
            breakdown.add("Driver offer: " + formatMoney(proposedFare))
        }
        if (pickupDistanceFee != null && pickupDistanceFee > 0.0) {
            breakdown.add("Pickup distance fee: " + formatMoney(pickupDistanceFee))
            breakdown.add("Formula: beyond 1.5 km, PHP 20.00 per 0.5 km")
        }

        val baseBreakdown = if (breakdown.isNotEmpty()) {
            breakdown.joinToString("\n")
        } else {
            "Review this fare before you proceed."
        }

        textFareResponse.text = when (response) {
            "accepted" -> baseBreakdown + "\nYou accepted this fare."
            "rejected" -> baseBreakdown + "\nYou requested a new driver."
            else -> baseBreakdown
        }

        val canRespond = normalized == "fare_proposed" && response.isNullOrBlank()
        btnAcceptFare.visibility = if (canRespond) View.VISIBLE else View.GONE
        btnRejectFare.visibility = if (canRespond) View.VISIBLE else View.GONE
    }

    private fun buildMetricsText(booking: PassengerBooking, normalized: String): String {
        val pickupReady = isPickupMetricsReady(booking)
        val waitingForDriverProposal = isWaitingForDriverProposal(booking)

        if (!pickupReady && (normalized == "assigned" || normalized == "accepted" || waitingForDriverProposal)) {
            return "Pickup: Waiting... | ETA: Waiting... | Trip: Waiting..."
        }

        val pickupKm = booking.driverToPickupKm
        val tripKm = booking.tripDistanceKm
        val etaMin = booking.pickupEtaMinutes

        val pickupText = if (pickupKm != null && pickupKm > 0.0) fmtKm(pickupKm) else "--"
        val etaText = if (etaMin != null && etaMin > 0) "$etaMin min" else "--"
        val tripText = if (tripKm != null && tripKm > 0.0) fmtKm(tripKm) else "--"

        return "Pickup: $pickupText | ETA: $etaText | Trip: $tripText"
    }

    private fun isFareReady(booking: PassengerBooking): Boolean {
        val explicit = reflectBooleanCompat(booking, "fareReady", "fare_ready")
        if (explicit != null) return explicit
        return booking.proposedFare != null || booking.verifiedFare != null || booking.totalFare != null
    }

    private fun isPickupMetricsReady(booking: PassengerBooking): Boolean {
        val explicit = reflectBooleanCompat(booking, "pickupMetricsReady", "pickup_metrics_ready")
        if (explicit != null) return explicit
        return booking.driverToPickupKm != null || booking.tripDistanceKm != null || booking.pickupEtaMinutes != null
    }

    private fun isWaitingForDriverProposal(booking: PassengerBooking): Boolean {
        val explicit = reflectBooleanCompat(booking, "waitingForDriverProposal", "waiting_for_driver_proposal")
        if (explicit != null) return explicit
        val normalized = normalizeStatus(booking.status)
        return (normalized == "assigned" || normalized == "accepted") && !isFareReady(booking)
    }

    private fun reflectBooleanCompat(target: Any, vararg names: String): Boolean? {
        for (name in names) {
            try {
                val getter = target.javaClass.methods.firstOrNull {
                    it.parameterTypes.isEmpty() && (
                        it.name.equals("get" + name.replaceFirstChar { c -> c.uppercase() }, true) ||
                            it.name.equals("is" + name.replaceFirstChar { c -> c.uppercase() }, true) ||
                            it.name.equals(name, true)
                        )
                }
                val raw = getter?.invoke(target)
                when (raw) {
                    is Boolean -> return raw
                    is Number -> return raw.toInt() != 0
                    is String -> {
                        val v = raw.trim().lowercase(Locale.US)
                        if (v == "true") return true
                        if (v == "false") return false
                    }
                }
            } catch (_: Exception) {
            }
        }
        return null
    }

    private fun cleanAddress(raw: String): String {
        return raw
            .replace(", Ifugao, Philippines", "", ignoreCase = true)
            .replace(", Ifugao", "", ignoreCase = true)
            .replace(", Philippines", "", ignoreCase = true)
            .replace("Ifugao, Philippines", "Ifugao", ignoreCase = true)
            .trim()
    }

    private fun hideFareCard() {
        cardFare.visibility = View.GONE
        textFareLabel.text = ""
        textFareValue.text = "-"
        textFareResponse.text = ""
        btnAcceptFare.visibility = View.GONE
        btnRejectFare.visibility = View.GONE
    }

    private fun showCompletionButtons() {
        btnBookAnother.visibility = View.VISIBLE
        btnDone.visibility = View.VISIBLE
        btnBack.visibility = View.GONE
    }

    private fun hideCompletionButtons() {
        btnBookAnother.visibility = View.GONE
        btnDone.visibility = View.GONE
        btnBack.visibility = View.VISIBLE
    }

    private fun renderSteps(status: String) {
        resetStep(stepRequested, "Requested")
        resetStep(stepAssigned, "Assigned")
        resetStep(stepOnTheWay, "On the way")
        resetStep(stepArrived, "Arrived")
        resetStep(stepOnTrip, "On trip")
        resetStep(stepCompleted, "Completed")

        when (status) {
            "pending" -> activateStep(stepRequested)
            "assigned", "accepted", "fare_proposed", "ready" -> {
                activateStep(stepRequested)
                activateStep(stepAssigned)
            }
            "on_the_way" -> {
                activateStep(stepRequested)
                activateStep(stepAssigned)
                activateStep(stepOnTheWay)
            }
            "arrived" -> {
                activateStep(stepRequested)
                activateStep(stepAssigned)
                activateStep(stepOnTheWay)
                activateStep(stepArrived)
            }
            "on_trip" -> {
                activateStep(stepRequested)
                activateStep(stepAssigned)
                activateStep(stepOnTheWay)
                activateStep(stepArrived)
                activateStep(stepOnTrip)
            }
            "completed" -> {
                activateStep(stepRequested)
                activateStep(stepAssigned)
                activateStep(stepOnTheWay)
                activateStep(stepArrived)
                activateStep(stepOnTrip)
                activateStep(stepCompleted)
            }
            "cancelled" -> activateStep(stepRequested)
        }
    }

    private fun resetStep(view: TextView, label: String) {
        view.text = label
        view.setBackgroundColor(mutedBg)
        view.setTextColor(mutedText)
    }

    private fun activateStep(view: TextView) {
        view.setBackgroundColor(mint)
        view.setTextColor(white)
    }

    private fun stopPollingTerminal() {
        polling = false
        handler.removeCallbacks(pollRunnable)
        btnAcceptFare.visibility = View.GONE
        btnRejectFare.visibility = View.GONE
    }

    private fun normalizeStatus(raw: String?): String {
        val s = raw?.trim()?.lowercase(Locale.ROOT).orEmpty()
        return when (s) {
            "" -> "unknown"
            "searching" -> "pending"
            "requested" -> "pending"
            "driver_assigned" -> "assigned"
            "accepted_by_driver" -> "accepted"
            "en_route", "on the way" -> "on_the_way"
            "in_progress" -> "on_trip"
            else -> s
        }
    }

    private fun nowStamp(): String {
        return SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
    }

    private fun fmtKm(value: Double): String {
        return String.format(Locale.US, "%.2f km", value)
    }

    private fun formatMoney(value: Double?): String {
        if (value == null) return "-"
        return "PHP " + String.format(Locale.US, "%.2f", value)
    }

    private fun showMsg(msg: String) {
        textMsg.text = msg
        textMsg.visibility = View.VISIBLE
    }

    companion object {
        const val EXTRA_BOOKING_CODE = "booking_code"

        fun newIntent(context: android.content.Context, bookingCode: String): Intent {
            return Intent(context, PassengerSearchingActivity::class.java).apply {
                putExtra(EXTRA_BOOKING_CODE, bookingCode)
            }
        }
    }
}