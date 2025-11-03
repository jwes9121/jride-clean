{/* Nearest driver */}
<div className="space-y-2">
  <div className="text-sm font-medium">Nearest driver (same town)</div>

  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
    <label className="text-sm">
      <span className="block text-gray-600 mb-1">Town</span>
      <input
        className="w-full rounded-md border px-3 py-2 text-sm"
        placeholder="e.g. Lagawe"
        value={town}
        onChange={(e) => setTown(e.target.value)}
      />
    </label>

    <label className="text-sm">
      <span className="block text-gray-600 mb-1">Radius (km)</span>
      <input
        className="w-full rounded-md border px-3 py-2 text-sm"
        type="number" min={0.5} max={50} step={0.5}
        placeholder="Search distance in km"
        value={radiusKm}
        onChange={(e) => setRadiusKm(Number(e.target.value))}
      />
    </label>

    <label className="text-sm">
      <span className="block text-gray-600 mb-1">Freshness (min)</span>
      <input
        className="w-full rounded-md border px-3 py-2 text-sm"
        type="number" min={1} max={120} step={1}
        placeholder="Driver last update window"
        value={freshMin}
        onChange={(e) => setFreshMin(Number(e.target.value))}
      />
    </label>
  </div>

  <div className="flex flex-wrap items-center gap-3 mt-2">
    <button
      onClick={findNearest}
      disabled={!hasPickup || finding}
      className="rounded-md px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {finding ? "Finding…" : "Find nearest"}
    </button>
    <span className="text-xs text-gray-500">
      Freshness = minutes since driver last sent a location update. Radius = search distance from pickup.
    </span>
  </div>

  {nearest ? (
    <div className="mt-3 text-sm rounded-md border p-3 bg-gray-50">
      <div><b>{nearest.name}</b> ({nearest.town})</div>
      <div>Dist: {nearest.distance_km.toFixed(2)} km • Updated: {new Date(nearest.updated_at).toLocaleTimeString()}</div>
    </div>
  ) : (
    <div className="mt-3 text-xs text-gray-500">No driver selected.</div>
  )}
</div>
