"use client";

import mapboxgl from "mapbox-gl";

/**
 * SAFETY HELPERS
 */
function ensureStyleLoaded(map: mapboxgl.Map, cb: () => void) {
  if (map.isStyleLoaded()) {
    cb();
  } else {
    map.once("style.load", () => cb());
  }
}

function safeAddSource(
  map: mapboxgl.Map,
  id: string,
  source: mapboxgl.GeoJSONSourceRaw
) {
  ensureStyleLoaded(map, () => {
    if (map.getSource(id)) {
      (map.getSource(id) as mapboxgl.GeoJSONSource).setData(source.data as any);
    } else {
      map.addSource(id, source);
    }
  });
}

function safeAddLayer(map: mapboxgl.Map, layer: mapboxgl.AnyLayer) {
  ensureStyleLoaded(map, () => {
    if (!map.getLayer(layer.id)) {
      map.addLayer(layer);
    }
  });
}

// --------------------------------------------------------------------
// BELOW THIS LINE: YOUR EXISTING COMPONENT LOGIC (UNCHANGED)
// --------------------------------------------------------------------

export function LiveTripsMap(props: any) {
  // ⚠️ keep your existing code
  // Replace ONLY map.addSource(...) and map.addLayer(...) calls with:
  //
  //   safeAddSource(map, id, {...})
  //   safeAddLayer(map, {...})
  //
  // Example fix shown below 👇

  function addRoute(map: mapboxgl.Map, routeId: string, data: any) {
    safeAddSource(map, routeId, {
      type: "geojson",
      data,
    });

    safeAddLayer(map, {
      id: routeId + "-line",
      type: "line",
      source: routeId,
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#16a34a",
        "line-width": 4,
      },
    });
  }

  return null; // your real JSX remains below in your file
}