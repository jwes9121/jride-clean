"use client";

import React, { useEffect, useState } from "react";

export interface DriverPerformanceCardProps {
  driverId?: string;
}

const DriverPerformanceCard: React.FC<DriverPerformanceCardProps> = ({
  driverId,
}) => {
  const [performance, setPerformance] = useState<any>(null);

  useEffect(() => {
    if (!driverId) return;

    // Example fetch Ã¢â‚¬" replace with your actual Supabase/Backend call
    const fetchPerformance = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/driver-performance?driverId=${driverId}`
        );
        const data = await response.json();
        setPerformance(data);
      } catch (error) {
        console.error("Error fetching driver performance:", error);
      }
    };

    fetchPerformance();
  }, [driverId]);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border">
      <h3 className="font-semibold mb-2">Driver Performance</h3>
      {performance ? (
        <div className="space-y-2 text-sm">
          <div>
            <span className="font-medium">Trips Completed:</span>{" "}
            {performance.trips_completed}
          </div>
          <div>
            <span className="font-medium">Average Rating:</span>{" "}
            {performance.average_rating}
          </div>
        </div>
      ) : (
        <p className="text-gray-500 text-sm">
          {driverId
            ? "Loading performance data..."
            : "No driver selected. Showing default state."}
        </p>
      )}
    </div>
  );
};

export default DriverPerformanceCard;



