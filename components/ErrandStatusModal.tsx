"use client";

import { useState } from "react";

interface StatusAction {
  status: string;
  label: string;
  icon: string;
  requiresInput?: boolean; // 👈 NEW: optional property
}

interface ErrandStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentStatus: string;
  onStatusChange: (status: string, details?: string) => void;
}

export default function ErrandStatusModal({
  isOpen,
  onClose,
  currentStatus,
  onStatusChange,
}: ErrandStatusModalProps) {
  const [details, setDetails] = useState("");

  if (!isOpen) return null;

  // 👇 Example status actions
  const statusActions: StatusAction[] = [
    { status: "pending", label: "Pending", icon: "ri-time-line" },
    { status: "in_progress", label: "In Progress", icon: "ri-loader-2-line" },
    { status: "completed", label: "Completed", icon: "ri-check-line", requiresInput: true },
    { status: "cancelled", label: "Cancelled", icon: "ri-close-line" },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">Update Errand Status</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {/* Status Options */}
        <div className="space-y-3">
          {statusActions.map((action) => (
            <button
              key={action.status}
              onClick={() => {
                if (!action.requiresInput) {
                  onStatusChange(action.status);
                  onClose();
                }
              }}
              className={`w-full flex items-center p-3 rounded-xl border transition ${
                currentStatus === action.status
                  ? "bg-blue-100 border-blue-500 text-blue-700"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <i className={`${action.icon} mr-3`} />
              {action.label}
            </button>
          ))}
        </div>

        {/* Completion Form - only if some action requires input */}
        {statusActions.some((action) => action.requiresInput) && (
          <div className="bg-blue-50 rounded-2xl p-4 mt-6">
            <h3 className="font-medium text-blue-900 mb-3">Final Details</h3>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Add final notes or completion details..."
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
            />
            <button
              onClick={() => {
                onStatusChange("completed", details);
                onClose();
              }}
              className="mt-3 w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition"
            >
              Submit Completion
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
