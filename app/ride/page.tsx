export const dynamic = 'force-dynamic';
'use client';

import { useEffect, useState } from "react";
import supabase from "@/lib/supabaseClient";

type Ride = {
  id: string;
  origin: string;
  destination: string;
};

export default function RidePage() {
  const [rides, setRides] = useState<Ride[]>([]);

  useEffect(() => {
    async function loadMyRides() {
      const { data, error } = await supabase.from("rides").select("*");
      if (!error && data) {
        setRides(data);
      }
    }
    loadMyRides();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">My Rides</h1>
      <ul>
        {rides.map((ride) => (
          <li key={ride.id}>
            {ride.origin} ? {ride.destination}
          </li>
        ))}
      </ul>
    </div>
  );
}


