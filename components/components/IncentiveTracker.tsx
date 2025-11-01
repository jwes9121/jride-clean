"use client";

import React, { useEffect, useState } from "react";

export interface IncentiveTrackerProps {
  driverId?: string;
}

const IncentiveTracker: React.FC<IncentiveTrackerProps> = ({ driverId }) => {
  const [incentives, setIncentives] = useState<any>(null);

  useEffect(() => {
    if (!driverId) return;

    const fetchIncentives = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/driver-incentives?driverId=${driverId}`
        );
        const data = await response.json();
        setIncentives(data);
      } catch (error) {
        console.error("Error fetching incentives:", error);
      }
    };

    fetchIncentives();
  }, [driverId]);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border">
      <h3 className="font-semibold mb-2">Incentive Tracker</h3>
      {incentives ? (
        <div className="space-y-2 text-sm">
          <div>
            <span className="font-medium">Trips Target:</span>{" "}
            {incentives.trips_target}
          </div>
          <div>
            <span className="font-medium">Completed:</span>{" "}
            {incentives.completed}
          </div>
          <div>
            <span className="font-medium">Bonus Earned:</span> â‚±
            {incentives.bonus || 0}
          </div>
        </div>
      ) : (
        <p className="text-gray-500 text-sm">
          {driverId
            ? "Loading incentive data..."
            : "No driver selected. Showing default state."}
        </p>
      )}
    </div>
  );
};

export default IncentiveTracker;



