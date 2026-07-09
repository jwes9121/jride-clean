\# JRide Advance Booking API Contract



\## Current Backend Status



Implemented:

\- POST /api/advance-bookings

\- GET /api/driver/advance-bookings/offers

\- POST /api/driver/advance-bookings/take



Not yet implemented:

\- Driver PASS

\- Passenger accept/decline

\- Locking

\- Conversion to live booking

\- Reminder worker



\---



\## 1. Create Advance Booking



POST /api/advance-bookings



Creates an advance booking and triggers driver offers.



\### Body



{

&#x20; "passengerId": "uuid",

&#x20; "pickupAddress": "Lagawe Plaza",

&#x20; "pickupLat": 16.0,

&#x20; "pickupLng": 121.0,

&#x20; "destinationAddress": "IFSU",

&#x20; "destinationLat": 16.0,

&#x20; "destinationLng": 121.0,

&#x20; "vehicleType": "tricycle",

&#x20; "scheduledPickupAt": "2026-07-08T03:00:00+08:00",

&#x20; "notes": "optional"

}



\### Response



{

&#x20; "ok": true,

&#x20; "advanceBookingId": "uuid",

&#x20; "bookingMode": "daytime | night",

&#x20; "fareBracket": "normal | double | late\_night",

&#x20; "scheduledPickupAt": "...",

&#x20; "status": "open",

&#x20; "reminderJobsCreated": 2,

&#x20; "offersCreated": 1

}



\---



\## 2. Driver Offers



GET /api/driver/advance-bookings/offers



Returns current offered advance bookings for the authenticated driver.



\### Auth



Bearer token, or:



x-jride-driver-secret header plus driver\_id query param.



\### Response



{

&#x20; "ok": true,

&#x20; "offers": \[

&#x20;   {

&#x20;     "offerId": "uuid",

&#x20;     "advanceBookingId": "uuid",

&#x20;     "pickup": "Lagawe Plaza",

&#x20;     "destination": "IFSU",

&#x20;     "scheduledPickupAt": "...",

&#x20;     "bookingMode": "night",

&#x20;     "fareBracket": "late\_night",

&#x20;     "tripDistanceKm": 5.2,

&#x20;     "vehicleType": "tricycle",

&#x20;     "estimatedFare": null,

&#x20;     "offerExpiresAt": "...",

&#x20;     "secondsRemaining": 183

&#x20;   }

&#x20; ]

}



\---



\## 3. Driver TAKE



POST /api/driver/advance-bookings/take



Driver accepts the advance booking offer.



\### Auth



Bearer token, or:



x-jride-driver-secret header plus driver\_id query param.



\### Body



{

&#x20; "offerId": "uuid",

&#x20; "departureOption": "current\_gps | home | other",

&#x20; "departureLat": 16.0,

&#x20; "departureLng": 121.0,

&#x20; "commitmentConfirmed": true

}



\### Response



{

&#x20; "ok": true,

&#x20; "advanceBookingId": "uuid",

&#x20; "pickupFee": 0,

&#x20; "total": 170

}



\### Important Android Rule



TAKE button must stay disabled until:

\- departureOption is selected,

\- departureLat and departureLng are present,

\- commitmentConfirmed is true.



Current TAKE pricing still uses pickupFee = 0 as a temporary backend stub. Android must not treat this as final fare logic yet.



\---



\## Android Driver UI Rule



Flow:



1\. Driver opens Advance Booking Offer.

2\. Show pickup, destination, scheduled time, fare bracket, trip distance.

3\. Ask: "Where will you start this trip?"

&#x20;  - Current GPS

&#x20;  - Home

&#x20;  - Other / Pin on map

4\. Enable TAKE only after location is selected.

5\. Driver confirms commitment.

6\. Submit TAKE request.



\---



\## Fare Brackets



Based on scheduled pickup time in Philippine Time:



\- 05:00-19:59 = normal

\- 20:00-22:59 = double

\- 23:00-04:59 = late\_night



Late night = base 100 + fare matrix.

