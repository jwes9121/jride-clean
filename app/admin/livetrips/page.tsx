async function handleAssignNearest(ride: any) {
  setLoading(true);
  const res = await fetch("/api/rides/assign-nearest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ride_id: ride.id,
      pickup_lat: ride.pickup_lat,
      pickup_lng: ride.pickup_lng,
      town: ride.town,
    }),
  });

  const result = await res.json();
  setLoading(false);

  if (result.status === "ok") {
    alert(`Driver assigned: ${result.driver_id}`);
    refreshRides();
  } else if (result.status === "no_driver") {
    alert("No available driver nearby!");
  } else {
    alert("Error assigning driver.");
  }
}
