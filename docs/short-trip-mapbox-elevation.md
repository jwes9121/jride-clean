# Short-trip elevation provider

Regular rides at or below 3.0 km use the authoritative Mapbox Directions road
distance. The server samples Mapbox Terrain-RGB along the full road geometry.
The existing Mapbox token configuration is reused. OPEN_METEO_API_KEY and
OPEN_METEO_ELEVATION_ENDPOINT are no longer read by this feature.

## Processing and provenance

- Tileset: mapbox.terrain-rgb, zoom 14, 512 by 512 PNGRAW tiles.
- Source: mapbox_terrain_rgb_v1.
- Processing version: terrain_rgb_z14_512_30m_median3_hysteresis3m_v1.
- Fare provenance: mapbox_road_terrain_rgb_v1.
- Uniform route samples at no more than 30 m spacing, including both endpoints.
- Decode RGB losslessly and interpolate nearby pixels. Reject transparent pixels,
  missing tiles, invalid images, out-of-range heights, and inconsistent geometry.
- Apply a three-point median filter and 3 m turning-point hysteresis. Small
  reversals do not accumulate artificial gain. Count each retained climb in full.
- Reject filtered elevation jumps exceeding max(3 m, 60% of sample spacing).

This is terrain-model validation, not a surveyed road profile. Terrain-RGB is a
multi-source dataset whose updates stopped in December 2021; bridges, cuttings,
and changed roads may differ from the terrain model. The RGB encoding's 0.1 m
increments are not an accuracy guarantee. Sample counts and provenance must be
retained in the evaluation metadata before any source/filter changes are made.

The fare remains max(P25, P20 * road_km + max(0, validated_gain_m - 25) * P0.10).
Add the existing P15 convenience fee and applicable pickup-distance fee separately.
The existing promo and wallet rules are unchanged. Trips above 3 km retain the
Proposed Fare process and do not request elevation tiles.

## Provider failure and acceptance

If a regular ride cannot be classified because routing is unavailable, or a
confirmed short trip cannot be priced using validated elevation/pickup data,
acceptance returns HTTP 503 with AUTOMATIC_FARE_UNAVAILABLE. The original driver
assignment and acceptance deadline remain in force. Retrying may succeed within
that deadline; expiry/reassignment still operates normally. No zero elevation is
fabricated and no Proposed Fare timer is started for these failures.

Successful short-trip acceptance persists the full fare evaluation and a linked
fare_accepted lifecycle event, transitions to ready, and clears fare timers.
The live database guard rechecks the acceptance deadline and validates the
automatic-fare markers. No schema migration is required for this provider change.
Already accepted legacy bookings are not repriced.

## Request budget

Deduplicate tiles within an evaluation and concurrent requests in a server process.
Cache at most 64 decoded tiles for five minutes. Each cold evaluation requests at
most 16 tiles; failed requests are not cached. Each tile request has a five-second
timeout. Cache availability depends on the lifetime of each server process.

Mapbox listed 750,000 Raster Tiles requests per month free on September 25, 2026.
This is an account-wide allowance, not a spending cap. Overages are billable.
Monitor the Raster Tiles API metric in Mapbox Statistics; no paid plan is added
by this code change.

## Verification

Run npm run test:short-trip-automatic-fare and npm run build. Tests cover terrain
decoding, sampling, noise, unavailable/invalid data, cache reuse and failure retry,
the 3 km boundary, minimum/proportional fares, snapshot/event payloads, acceptance
deadlines, lost update races, and preservation of the long-trip fare flow.

Before claiming a phone test passed, verify a NEW booking has:

- ride_fare_mode = short_trip_automatic_v1
- ride_fare_provenance = mapbox_road_terrain_rgb_v1
- short_trip_elevation_status = validated
- short_trip_fare_evaluation.elevation_version matching the version above
- status = ready after acceptance and both fare/acceptance deadlines cleared
- a matching fare_accepted lifecycle event containing the same evaluation

References:
https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/
https://docs.mapbox.com/api/maps/raster-tiles/
https://www.mapbox.com/pricing
