"use client";

import React from "react";

type ActiveTripIndicatorProps = {
  isActive: boolean;
};

const ActiveTripIndicator: React.FC<ActiveTripIndicatorProps> = ({
  isActive,
}) => {
  return (
    <span className="inline-flex items-center justify-center mr-2">
      <span
        className={[
          "relative inline-flex h-2.5 w-2.5 rounded-full",
          isActive ? "bg-blue-500" : "bg-gray-300",
        ].join(" ")}
      >
        {isActive && (
          <span className="absolute inline-flex h-full w-full rounded-full animate-ping bg-blue-400 opacity-60" />
        )}
      </span>
    </span>
  );
};

export default ActiveTripIndicator;
