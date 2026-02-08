# JRIDE Remote Booking Smoke Test

- Generated: 2026-02-08 15:06:56
- Base URL: https://app.jride.net
- Town: Hingyon
- Vehicle type: tricycle
- Passenger count: 1
- Target driver: (auto-assign)
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
    "booking_code":  "JR-UI-20260208070657-0794",
    "booking":  {
                    "id":  "9e3ad206-401d-4038-9db3-f922dbf74228",
                    "booking_code":  "JR-UI-20260208070657-0794",
                    "passenger_name":  "SmokeTest Passenger",
                    "from_label":  null,
                    "to_label":  null,
                    "town":  "Hingyon",
                    "pickup_lat":  16.88,
                    "pickup_lng":  121.13,
                    "dropoff_lat":  16.882,
                    "dropoff_lng":  121.135,
                    "status":  "assigned",
                    "created_at":  "2026-02-08T07:06:58.309839+00:00",
                    "assigned_driver_id":  null,
                    "assigned_at":  null,
                    "updated_at":  "2026-02-08T07:06:58.309839+00:00",
                    "proposed_fare":  null,
                    "passenger_fare_response":  null,
                    "verified_fare":  null,
                    "verified_by":  null,
                    "verified_at":  null,
                    "verified_reason":  null,
                    "driver_id":  "bb5e5daa-2390-4b38-91d7-c8a8da313c45",
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
                   "booking_id":  "9e3ad206-401d-4038-9db3-f922dbf74228",
                   "booking_code":  "JR-UI-20260208070657-0794",
                   "driver_id":  "bb5e5daa-2390-4b38-91d7-c8a8da313c45",
                   "note":  "Nearest ONLINE free driver selected (km=4.592).",
                   "update_ok":  true,
                   "update_error":  null,
                   "booking":  {
                                   "id":  "9e3ad206-401d-4038-9db3-f922dbf74228",
                                   "booking_code":  "JR-UI-20260208070657-0794",
                                   "passenger_name":  "SmokeTest Passenger",
                                   "from_label":  null,
                                   "to_label":  null,
                                   "town":  "Hingyon",
                                   "pickup_lat":  16.88,
                                   "pickup_lng":  121.13,
                                   "dropoff_lat":  16.882,
                                   "dropoff_lng":  121.135,
                                   "status":  "assigned",
                                   "created_at":  "2026-02-08T07:06:58.309839+00:00",
                                   "assigned_driver_id":  null,
                                   "assigned_at":  null,
                                   "updated_at":  "2026-02-08T07:06:58.309839+00:00",
                                   "proposed_fare":  null,
                                   "passenger_fare_response":  null,
                                   "verified_fare":  null,
                                   "verified_by":  null,
                                   "verified_at":  null,
                                   "verified_reason":  null,
                                   "driver_id":  "bb5e5daa-2390-4b38-91d7-c8a8da313c45",
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

Polling URL: https://app.jride.net/api/public/passenger/booking?code=JR-UI-20260208070657-0794

| # | time | status | driver_id | note |
| -: | --- | --- | --- | --- |
| 1 | 15:06:59 | (unknown) | (none yet) |  |
| 2 | 15:07:03 | (unknown) | (none yet) |  |
| 3 | 15:07:07 | (unknown) | (none yet) |  |
| 4 | 15:07:10 | (unknown) | (none yet) |  |
| 5 | 15:07:14 | (unknown) | (none yet) |  |
| 6 | 15:07:17 | (unknown) | (none yet) |  |
| 7 | 15:07:21 | (unknown) | (none yet) |  |
| 8 | 15:07:25 | (unknown) | (none yet) |  |
| 9 | 15:07:28 | (unknown) | (none yet) |  |
| 10 | 15:07:32 | (unknown) | (none yet) |  |
| 11 | 15:07:36 | (unknown) | (none yet) |  |
| 12 | 15:07:39 | (unknown) | (none yet) |  |
| 13 | 15:07:43 | (unknown) | (none yet) |  |
| 14 | 15:07:46 | (unknown) | (none yet) |  |
| 15 | 15:07:50 | (unknown) | (none yet) |  |
| 16 | 15:07:54 | (unknown) | (none yet) |  |
| 17 | 15:07:57 | (unknown) | (none yet) |  |

## 3) Optional: probe driver active-trip endpoints

Resolved driver_id: bb5e5daa-2390-4b38-91d7-c8a8da313c45

Hit: https://app.jride.net/api/driver/active-trip?driver_id=bb5e5daa-2390-4b38-91d7-c8a8da313c45
```json
{
    "ok":  true,
    "driver_id":  "bb5e5daa-2390-4b38-91d7-c8a8da313c45",
    "trip":  {
                 "id":  "9e3ad206-401d-4038-9db3-f922dbf74228",
                 "created_at":  "2026-02-08T07:06:58.309839+00:00",
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

