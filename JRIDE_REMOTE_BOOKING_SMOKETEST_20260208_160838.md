# JRIDE Remote Booking Smoke Test

- Generated: 2026-02-08 16:08:38
- Base URL: https://app.jride.net
- Town: Hingyon
- Vehicle type: tricycle
- Passenger count: 1
- Target driver: d41bf199-96c6-4022-8a3d-09ab9dbd270f
- Pickup: 16.88, 121.13
- Dropoff: 16.882, 121.135

## 1) Create booking

Create endpoint used: https://app.jride.net/api/public/passenger/book

Response JSON:
```json
{
    "ok":  true,
    "env":  {
                "supabase_host":  "gxaullwnxbkbjqbjotsr.supabase.co",
                "vercel_env":  "production",
                "nextauth_url":  "https://app.jride.net"
            },
    "booking_code":  "JR-UI-20260208080839-1880",
    "booking":  {
                    "id":  "54da3c39-cbd2-4ad2-b902-019d6410139f",
                    "booking_code":  "JR-UI-20260208080839-1880",
                    "passenger_name":  "SmokeTest Passenger",
                    "from_label":  null,
                    "to_label":  null,
                    "town":  "Hingyon",
                    "pickup_lat":  16.88,
                    "pickup_lng":  121.13,
                    "dropoff_lat":  16.882,
                    "dropoff_lng":  121.135,
                    "status":  "assigned",
                    "created_at":  "2026-02-08T08:08:39.536964+00:00",
                    "assigned_driver_id":  null,
                    "assigned_at":  null,
                    "updated_at":  "2026-02-08T08:08:39.536964+00:00",
                    "proposed_fare":  null,
                    "passenger_fare_response":  null,
                    "verified_fare":  null,
                    "verified_by":  null,
                    "verified_at":  null,
                    "verified_reason":  null,
                    "driver_id":  "cd4f5bb0-6a58-4c83-ab39-93fa757b8280",
                    "trip_type":  null,
                    "passenger_count":  1,
                    "created_by_user_id":  null,
                    "base_fee":  0,
                    "distance_fare":  0,
                    "waiting_minutes":  0,
                    "waiting_fee":  0,
                    "stop_count":  1,
                    "extra_stop_fee":  0,
                    "total_errand_fare":  0,
                    "company_cut":  0,
                    "driver_payout":  0,
                    "errand_cash_mode":  null,
                    "service_type":  null,
                    "vendor_status":  null,
                    "customer_status":  null,
                    "driver_status":  null,
                    "vendor_driver_arrived_at":  null,
                    "vendor_order_picked_at":  null,
                    "vendor_id":  null,
                    "zone_id":  null,
                    "is_emergency":  false,
                    "emergency_updated_at":  null,
                    "takeout_service_level":  "regular",
                    "takeout_items_subtotal":  0
                },
    "assign":  {
                   "ok":  true,
                   "assigned":  true,
                   "booking_id":  "54da3c39-cbd2-4ad2-b902-019d6410139f",
                   "booking_code":  "JR-UI-20260208080839-1880",
                   "driver_id":  "cd4f5bb0-6a58-4c83-ab39-93fa757b8280",
                   "note":  "Nearest ONLINE free driver selected (km=5.841).",
                   "update_ok":  true,
                   "update_error":  null,
                   "booking":  {
                                   "id":  "54da3c39-cbd2-4ad2-b902-019d6410139f",
                                   "booking_code":  "JR-UI-20260208080839-1880",
                                   "passenger_name":  "SmokeTest Passenger",
                                   "from_label":  null,
                                   "to_label":  null,
                                   "town":  "Hingyon",
                                   "pickup_lat":  16.88,
                                   "pickup_lng":  121.13,
                                   "dropoff_lat":  16.882,
                                   "dropoff_lng":  121.135,
                                   "status":  "assigned",
                                   "created_at":  "2026-02-08T08:08:39.536964+00:00",
                                   "assigned_driver_id":  null,
                                   "assigned_at":  null,
                                   "updated_at":  "2026-02-08T08:08:39.536964+00:00",
                                   "proposed_fare":  null,
                                   "passenger_fare_response":  null,
                                   "verified_fare":  null,
                                   "verified_by":  null,
                                   "verified_at":  null,
                                   "verified_reason":  null,
                                   "driver_id":  "cd4f5bb0-6a58-4c83-ab39-93fa757b8280",
                                   "trip_type":  null,
                                   "passenger_count":  1,
                                   "created_by_user_id":  null,
                                   "base_fee":  0,
                                   "distance_fare":  0,
                                   "waiting_minutes":  0,
                                   "waiting_fee":  0,
                                   "stop_count":  1,
                                   "extra_stop_fee":  0,
                                   "total_errand_fare":  0,
                                   "company_cut":  0,
                                   "driver_payout":  0,
                                   "errand_cash_mode":  null,
                                   "service_type":  null,
                                   "vendor_status":  null,
                                   "customer_status":  null,
                                   "driver_status":  null,
                                   "vendor_driver_arrived_at":  null,
                                   "vendor_order_picked_at":  null,
                                   "vendor_id":  null,
                                   "zone_id":  null,
                                   "is_emergency":  false,
                                   "emergency_updated_at":  null,
                                   "takeout_service_level":  "regular",
                                   "takeout_items_subtotal":  0
                               }
               },
    "takeoutSnapshot":  null
}
```

## 2) Poll passenger booking status

Polling URL: https://app.jride.net/api/public/passenger/booking?code=JR-UI-20260208080839-1880

| # | time | status | driver_id | note |
| -: | --- | --- | --- | --- |
| 1 | 16:08:41 | (unknown) | (none yet) |  |
| 2 | 16:08:44 | (unknown) | (none yet) |  |
| 3 | 16:08:48 | (unknown) | (none yet) |  |
| 4 | 16:08:51 | (unknown) | (none yet) |  |
| 5 | 16:08:55 | (unknown) | (none yet) |  |
| 6 | 16:08:59 | (unknown) | (none yet) |  |
| 7 | 16:09:02 | (unknown) | (none yet) |  |
| 8 | 16:09:06 | (unknown) | (none yet) |  |
| 9 | 16:09:09 | (unknown) | (none yet) |  |
| 10 | 16:09:13 | (unknown) | (none yet) |  |
| 11 | 16:09:17 | (unknown) | (none yet) |  |
| 12 | 16:09:20 | (unknown) | (none yet) |  |
| 13 | 16:09:24 | (unknown) | (none yet) |  |
| 14 | 16:09:27 | (unknown) | (none yet) |  |
| 15 | 16:09:31 | (unknown) | (none yet) |  |
| 16 | 16:09:35 | (unknown) | (none yet) |  |
| 17 | 16:09:38 | (unknown) | (none yet) |  |

## 3) Optional: probe driver active-trip endpoints

Resolved driver_id: cd4f5bb0-6a58-4c83-ab39-93fa757b8280

Hit: https://app.jride.net/api/driver/active-trip?driver_id=cd4f5bb0-6a58-4c83-ab39-93fa757b8280
```json
{
    "ok":  true,
    "driver_id":  "cd4f5bb0-6a58-4c83-ab39-93fa757b8280",
    "trip":  {
                 "id":  "54da3c39-cbd2-4ad2-b902-019d6410139f",
                 "created_at":  "2026-02-08T08:08:39.536964+00:00",
                 "town":  "Hingyon",
                 "status":  "assigned",
                 "assigned_driver_id":  null,
                 "pickup_lat":  16.88,
                 "pickup_lng":  121.13,
                 "dropoff_lat":  16.882,
                 "dropoff_lng":  121.135
             },
    "note":  "ACTIVE_TRIP_FOUND",
    "active_statuses":  [
                            "assigned",
                            "accepted",
                            "on_the_way",
                            "arrived",
                            "on_trip"
                        ]
}
```

