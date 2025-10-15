'use client';

import { useState } from 'react';

interface PassengerCountVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (actualCount: number, driverAccepts: boolean) => void;
  declaredCount: number;
  vehicleType: string;
  rideId: string;
}

export default function PassengerCountVerificationModal({
  isOpen,
  onClose,
  onConfirm,
  declaredCount,
  vehicleType,
  rideId
}: PassengerCountVerificationModalProps) {
  const [actualCount, setActualCount] = useState(declaredCount);
  const [driverAccepts, setDriverAccepts] = useState(true);
  const [showScript, setShowScript] = useState(true);

  if (!isOpen) return null;

  const maxCapacity = vehicleType === 'motorcycle' ? 1 : 5;
  const fareAdjustmentNeeded = actualCount !== declaredCount;
  const additionalFare = fareAdjustmentNeeded ? (actualCount - declaredCount) * 10 : 0;

  const handleConfirm = () => {
    onConfirm(actualCount, driverAccepts);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <i className="ri-group-line text-xl text-blue-600"></i>
            </div>
            <div>
              <h3 className="text-xl font-bold">Passenger Count Verification</h3>
              <p className="text-sm text-gray-600">Confirm actual number of passengers</p>
            </div>
          </div>

          {/* Booking Info */}
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">Declared Count:</span>
              <span className="font-bold text-blue-600">{declaredCount} passenger{declaredCount !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Vehicle:</span>
              <span className="font-medium capitalize">{vehicleType}</span>
            </div>
          </div>
        </div>

        {/* Driver Script */}
        {showScript && (
          <div className="p-4 bg-gradient-to-r from-blue-50 to-green-50 border-b">
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                <i className="ri-chat-3-line text-white text-sm"></i>
              </div>
              <div>
                <h4 className="font-semibold text-blue-900 mb-2">Driver Script:</h4>
                <div className="text-sm text-blue-800 bg-white/70 p-3 rounded-lg">
                  "Good day Ma'am/Sir, I see passengers boarding. The booking shows {declaredCount} passenger{declaredCount !== 1 ? 's' : ''}. The system will update the fare accordingly if needed. Is that okay?"
                </div>
                <button
                  onClick={() => setShowScript(false)}
                  className="text-xs text-blue-600 hover:text-blue-800 mt-2"
                >
                  Hide script
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Actual Count Selection */}
        <div className="p-6">
          <h4 className="font-semibold mb-4">Actual Number of Passengers:</h4>
          
          <div className="grid grid-cols-5 gap-2 mb-4">
            {Array.from({ length: maxCapacity }, (_, i) => i + 1).map((count) => (
              <button
                key={count}
                onClick={() => setActualCount(count)}
                className={`h-12 rounded-lg border-2 font-semibold transition-colors ${
                  actualCount === count
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {count}
              </button>
            ))}
          </div>

          {/* Fare Adjustment Notice */}
          {fareAdjustmentNeeded && (
            <div className={`p-4 rounded-lg mb-4 ${
              additionalFare > 0 
                ? 'bg-orange-50 border border-orange-200' 
                : 'bg-green-50 border border-green-200'
            }`}>
              <div className="flex items-center space-x-2 mb-2">
                <i className={`ri-information-line ${
                  additionalFare > 0 ? 'text-orange-600' : 'text-green-600'
                }`}></i>
                <span className="font-semibold">Fare Adjustment Required</span>
              </div>
              <div className="text-sm">
                {additionalFare > 0 ? (
                  <>
                    <p className="text-orange-800 mb-2">
                      Additional {actualCount - declaredCount} passenger{actualCount - declaredCount !== 1 ? 's' : ''} detected.
                    </p>
                    <div className="bg-white/70 p-2 rounded">
                      <div className="flex justify-between">
                        <span>Additional fare:</span>
                        <span className="font-bold text-orange-700">+₱{additionalFare}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-green-800">
                    Fewer passengers than declared. Fare will be reduced by ₱{Math.abs(additionalFare)}.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Driver Acceptance */}
          {fareAdjustmentNeeded && additionalFare > 0 && (
            <div className="mb-4">
              <h5 className="font-medium mb-3">Driver Decision:</h5>
              <div className="space-y-2">
                <label className="flex items-center space-x-3">
                  <input
                    type="radio"
                    name="driverAccepts"
                    checked={driverAccepts}
                    onChange={() => setDriverAccepts(true)}
                    className="text-green-500"
                  />
                  <span>Accept ride with adjusted fare</span>
                </label>
                <label className="flex items-center space-x-3">
                  <input
                    type="radio"
                    name="driverAccepts"
                    checked={!driverAccepts}
                    onChange={() => setDriverAccepts(false)}
                    className="text-red-500"
                  />
                  <span>Decline ride (passenger misdeclared)</span>
                </label>
              </div>
            </div>
          )}

          {/* Warning for passenger refusal */}
          {!driverAccepts && (
            <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-4">
              <div className="flex items-start space-x-2">
                <i className="ri-alert-line text-red-600 mt-0.5"></i>
                <div>
                  <p className="text-sm font-medium text-red-800">Incident will be recorded</p>
                  <p className="text-xs text-red-700 mt-1">
                    Passenger misdeclaration and fare refusal will be flagged for review.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-6 border-t space-y-3">
          <button
            onClick={handleConfirm}
            className={`w-full py-3 rounded-xl font-semibold transition-colors ${
              driverAccepts 
                ? 'bg-green-500 text-white hover:bg-green-600'
                : 'bg-red-500 text-white hover:bg-red-600'
            }`}
          >
            {driverAccepts ? 'Confirm & Start Trip' : 'Record Incident & Cancel'}
          </button>
          
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl font-semibold bg-gray-200 text-gray-800 hover:bg-gray-300 transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
