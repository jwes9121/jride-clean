
'use client';

import { useState } from 'react';

interface RideRequest {
  id: string;
  pickup_location: string;
  destination_location: string;
  vehicle_type: string;
  passenger_count: number;
  suggested_fare: number;
  user?: {
    full_name: string;
    phone: string;
    verification_status: string;
  };
}

interface DriverFareModalProps {
  isOpen: boolean;
  onClose: () => void;
  rideRequest: RideRequest | null;
  onProposeFare: (fareAmount: number) => void;
}

export default function DriverFareModal({ isOpen, onClose, rideRequest, onProposeFare }: DriverFareModalProps) {
  const [proposedFare, setProposedFare] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !rideRequest) return null;

  const suggestedFare = rideRequest.suggested_fare;
  const bufferAmount = 10;
  const suggestedWithBuffer = suggestedFare + bufferAmount;
  const minFare = Math.max(20, suggestedFare - 10);
  const maxFare = suggestedFare + 30;

  const handleProposeFare = async () => {
    const fare = parseFloat(proposedFare);
    
    if (!fare || fare < minFare || fare > maxFare) {
      alert(`Fare must be between Ã¢â€š±${minFare} and Ã¢â€š±${maxFare}`);
      return;
    }

    setIsSubmitting(true);
    try {
      await onProposeFare(fare);
      onClose();
    } catch (error) {
      console.error('Error proposing fare:', error);
      alert('Failed to propose fare. Please try again.');
    }
    setIsSubmitting(false);
  };

  const setQuickFare = (amount: number) => {
    setProposedFare(amount.toString());
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-96 overflow-y-auto">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-orange-100 rounded-full mx-auto mb-4 flex items-center justify-center">
            <i className="ri-money-dollar-circle-line text-2xl text-orange-600"></i>
          </div>
          <h3 className="text-xl font-bold">New Ride Request</h3>
          <p className="text-sm text-gray-600 mt-2">Set your fare for this trip</p>
        </div>

        {/* Trip Details */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="space-y-3 text-sm">
            <div className="flex items-start space-x-3">
              <i className="ri-map-pin-line text-green-600 mt-0.5"></i>
              <div>
                <div className="font-medium text-gray-800">Pickup</div>
                <div className="text-gray-600">{rideRequest.pickup_location}</div>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <i className="ri-flag-line text-red-600 mt-0.5"></i>
              <div>
                <div className="font-medium text-gray-800">Destination</div>
                <div className="text-gray-600">{rideRequest.destination_location}</div>
              </div>
            </div>
            
            <div className="flex items-center justify-between pt-2 border-t border-gray-200">
              <div className="flex items-center space-x-4">
                <div>
                  <div className="text-xs text-gray-500">Vehicle</div>
                  <div className="font-medium capitalize">{rideRequest.vehicle_type}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Passengers</div>
                  <div className="font-medium">{rideRequest.passenger_count}</div>
                </div>
              </div>
              
              {rideRequest.user?.verification_status === 'verified' && (
                <div className="flex items-center space-x-1 bg-green-100 px-2 py-1 rounded-full">
                  <i className="ri-shield-check-line text-green-600 text-xs"></i>
                  <span className="text-xs text-green-700 font-medium">Verified</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fare Section */}
        <div className="mb-6">
          <div className="text-center mb-4">
            <div className="text-lg font-bold text-orange-600">
              Suggested Rate: Ã¢â€š±{suggestedFare} + Ã¢â€š±{bufferAmount} buffer
            </div>
            <div className="text-sm text-gray-600">
              Recommended: Ã¢â€š±{suggestedWithBuffer}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Proposed Fare</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-600">Ã¢â€š±</span>
                <input
                  type="number"
                  value={proposedFare}
                  onChange={(e) => setProposedFare(e.target.value)}
                  placeholder={suggestedWithBuffer.toString()}
                  className="w-full pl-8 pr-4 py-3 text-lg font-semibold border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Allowed range: Ã¢â€š±{minFare} - Ã¢â€š±{maxFare}
              </div>
            </div>

            {/* Quick Fare Options */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setQuickFare(suggestedFare)}
                className="bg-gray-100 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-200 text-sm"
              >
                Ã¢â€š±{suggestedFare}
                <div className="text-xs text-gray-500">Base</div>
              </button>
              <button
                onClick={() => setQuickFare(suggestedWithBuffer)}
                className="bg-orange-100 text-orange-700 py-2 rounded-lg font-semibold hover:bg-orange-200 text-sm"
              >
                Ã¢â€š±{suggestedWithBuffer}
                <div className="text-xs text-orange-600">Suggested</div>
              </button>
              <button
                onClick={() => setQuickFare(suggestedFare + 20)}
                className="bg-blue-100 text-blue-700 py-2 rounded-lg font-semibold hover:bg-blue-200 text-sm"
              >
                Ã¢â€š±{suggestedFare + 20}
                <div className="text-xs text-blue-600">Premium</div>
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <button 
            onClick={handleProposeFare}
            disabled={isSubmitting || !proposedFare}
            className="w-full bg-orange-500 text-white py-3 rounded-xl font-semibold hover:bg-orange-600 disabled:bg-gray-300"
          >
            {isSubmitting ? 'Sending...' : `Propose Ã¢â€š±${proposedFare || '0'}`}
          </button>
          
          <button 
            onClick={onClose}
            className="w-full bg-gray-200 text-gray-700 py-3 rounded-xl font-semibold"
          >
            Decline Request
          </button>
        </div>

        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <div className="flex items-start space-x-2">
            <i className="ri-information-line text-blue-600 mt-0.5"></i>
            <div className="text-xs text-blue-700">
              <div className="font-medium mb-1">Fare Guidelines:</div>
              <ul className="space-y-1">
                <li>Ã¢â‚¬¢ Consider distance and traffic conditions</li>
                <li>Ã¢â‚¬¢ Weather and time of day factors</li>
                <li>Ã¢â‚¬¢ Passenger will see your proposed fare</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



