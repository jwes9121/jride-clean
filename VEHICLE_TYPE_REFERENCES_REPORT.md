# VEHICLE_TYPE REFERENCES REPORT

Repo: C:\Users\jwes9\Desktop\jride-clean-fresh
Generated: 2026-02-07 15:55:48

Patterns:
- bookings\.vehicle_type
- \bvehicle_type\b
- \bvehicleType\b

---

## app\admin\livetrips\dispatchRules.ts

| Line | Pattern | Snippet |
| ---: | --- | --- |
| 31 | \bvehicle_type\b | vehicle_type?: string \| null; |
| 68 | \bvehicle_type\b | if (info.vehicle_type \|\| info.plate_number) { |
| 70 | \bvehicle_type\b | info.vehicle_type \|\| undefined, |

## app\api\dispatch\status\route.ts

| Line | Pattern | Snippet |
| ---: | --- | --- |
| 111 | \bvehicle_type\b | .select("*, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, town, vehicle_type, verified_fare") |
| 523 | \bvehicle_type\b | .select("pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,town,vehicle_type,verified_fare"); |
| 541 | \bvehicle_type\b | const vehicle = String((booking?.vehicle_type ?? "") \|\| "").trim() \|\| null; |

## app\api\rides\create\route.ts

| Line | Pattern | Snippet |
| ---: | --- | --- |
| 6 | \bvehicle_type\b | const { pickup_lat, pickup_lng, town = "Lagawe", vehicle_type = "tricycle" } = await req.json(); |
| 14 | \bvehicle_type\b | .insert({ pickup_lat, pickup_lng, town, vehicle_type, status: "pending" }) |

## app\components\node modules\db\schema.sql

| Line | Pattern | Snippet |
| ---: | --- | --- |
| 19 | \bvehicle_type\b | vehicle_type text CHECK (vehicle_type IN ('tricycle','motorcycle')) NOT NULL, |

## app\components\node modules\db\seed.sql

| Line | Pattern | Snippet |
| ---: | --- | --- |
| 11 | \bvehicle_type\b | INSERT INTO drivers (name, phone, vehicle_type, plate_number) VALUES |

## app\ride\page.tsx

| Line | Pattern | Snippet |
| ---: | --- | --- |
| 2003 | \bvehicle_type\b | // PHASE12B_BACKEND_PROBE (read-only): does backend return vehicle_type / passenger_count? |
| 2006 | \bvehicle_type\b | const vtRaw: any = b ? (b.vehicle_type \|\| b.vehicleType) : ""; |
| 2016 | \bvehicle_type\b | lines.push("vehicle_type: " + (vt \|\| "(none)")); |
| 2019 | \bvehicle_type\b | lines.push("vehicle_type/passenger_count: (not returned by API)"); |
| 2022 | \bvehicle_type\b | lines.push("vehicle_type/passenger_count: (probe error)"); |
| 2896 | \bvehicle_type\b | const vehicle: any = b ? (b.vehicle_type ?? b.vehicleType ?? b.vehicle_label ?? b.vehicle ?? null) : null; |
| 478 | \bvehicleType\b | const [vehicleType, setVehicleType] = React.useState<"tricycle" \| "motorcycle">("tricycle"); |
| 1858 | \bvehicleType\b | const v = (vehicleType === "motorcycle") ? "motorcycle" : "tricycle"; |
| 2006 | \bvehicleType\b | const vtRaw: any = b ? (b.vehicle_type \|\| b.vehicleType) : ""; |
| 2410 | \bvehicleType\b | value={vehicleType} |
| 2428 | \bvehicleType\b | max={paxMaxForVehicle(vehicleType)} |
| 2433 | \bvehicleType\b | setPassengerCount(clampPax(vehicleType, e.target.value)); |
| 2896 | \bvehicleType\b | const vehicle: any = b ? (b.vehicle_type ?? b.vehicleType ?? b.vehicle_label ?? b.vehicle ?? null) : null; |

---

Total matches: 23


