import React from "react";

export interface VerificationStatusBadgeProps {
  status: "pending" | "verified" | "unverified" | "rejected";
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}

export default function VerificationStatusBadge({
  status,
  size = "md",
  onClick,
}: VerificationStatusBadgeProps) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
    verified: "bg-green-100 text-green-800 border-green-300",
    unverified: "bg-gray-100 text-gray-800 border-gray-300",
    rejected: "bg-red-100 text-red-800 border-red-300",
  };

  const sizes: Record<string, string> = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-2 text-base",
  };

  return (
    <span
      onClick={onClick}
      className={`inline-block rounded-full border font-medium cursor-pointer ${colors[status]} ${sizes[size]}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}



