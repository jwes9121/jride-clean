'use client';

import { useState } from 'react';

interface DistanceSurchargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (accepted: boolean) => void;
  distanceData: {
    distance: number;
    surcharge: number;
    baseFare: number;
    totalFare: number;
    driverName?: string;
    isLongDistance?: boolean;
    proposedFare?: number;
    lateNightInfo?: {
      isLateNight: boolean;
      multiplier: number;
      premium: number;
      period: string | null;
      description: string | null;
    };
  };
  serviceType: 'ride' | 'delivery';
}

export default function DistanceSurchargeModal({
  isOpen,
  onClose,
  onConfirm,
  distanceData,
  serviceType
}: DistanceSurchargeModalProps) {
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const getSurchargeText = (distance: number, surcharge: number) => {
    if (distance <= 1.5) return 'Free pickup within 1.5km';
    if (distance <= 2.0) return `₱${surcharge} surcharge (1.5-2.0km)`;
    if (distance <= 3.0) return `₱${surcharge} surcharge (2.1-3.0km)`;
    if (distance <= 3.5) return `₱${surcharge} surcharge (3.1-3.5km)`;
    if (distance <= 4.0) return `₱${surcharge} surcharge (3.6-4.0km)`;
    return 'Custom fare (>4km distance)';
  };

  const handleConfirm = async (accepted: boolean) => {
    setLoading(true);
    await onConfirm(accepted);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-orange-100 rounded-full mx-auto mb-4 flex items-center justify-center">
            <i className="ri-map-pin-range-line text-2xl text-orange-600"></i>
          </div>
          <h3 className="text-xl font-bold">
            {distanceData.isLongDistance ? 'Driver Proposed Fare' : 'Pickup Distance Fee'}
          </h3>
          <p className="text-sm text-gray-600 mt-2">
            {serviceType === 'ride' ? 'Ride' : 'Delivery'} fare breakdown
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Distance to driver:</span>
              <span className="font-medium">{distanceData.distance.toFixed(1)}km</span>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Base {serviceType} fare:</span>
              <span className="font-medium">₱{distanceData.baseFare}</span>
            </div>

            {/* Show late night adjustments if applicable */}
            {distanceData.lateNightInfo?.isLateNight && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 my-2">
                <div className="text-xs font-medium text-purple-800 mb-1">
                  Late Night Adjustment ({distanceData.lateNightInfo.period})
                </div>
                
                {distanceData.lateNightInfo.multiplier > 1 && (
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-purple-700">
                      Double fare ({distanceData.lateNightInfo.multiplier}x):
                    </span>
                    <span className="font-medium text-purple-800">
                      ₱{30 * distanceData.lateNightInfo.multiplier}
                    </span>
                  </div>
                )}
                
                {distanceData.lateNightInfo.premium > 0 && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-purple-700">Night premium:</span>
                    <span className="font-medium text-purple-800">
                      +₱{distanceData.lateNightInfo.premium}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Pickup fee:</span>
              <span className={`font-medium ${distanceData.surcharge === 0 ? 'text-green-600' : 'text-orange-600'}`}>
                {distanceData.surcharge === 0 ? 'FREE' : `₱${distanceData.surcharge}`}
              </span>
            </div>

            <div className="border-t pt-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Total Fare:</span>
                <span className="text-xl font-bold text-orange-600">
                  ₱{distanceData.isLongDistance ? distanceData.proposedFare : distanceData.totalFare}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className={`rounded-lg p-4 mb-6 ${
          distanceData.isLongDistance ? 'bg-blue-50 border border-blue-200' : 
          distanceData.surcharge === 0 ? 'bg-green-50 border border-green-200' : 
          'bg-orange-50 border border-orange-200'
        }`}>
          <div className="flex items-start space-x-3">
            <i className={`mt-0.5 ${
              distanceData.isLongDistance ? 'ri-information-line text-blue-600' :
              distanceData.surcharge === 0 ? 'ri-check-line text-green-600' : 
              'ri-price-tag-3-line text-orange-600'
            }`}></i>
            <div>
              <p className={`text-sm font-medium ${
                distanceData.isLongDistance ? 'text-blue-800' :
                distanceData.surcharge === 0 ? 'text-green-800' : 
                'text-orange-800'
              }`}>
                {distanceData.isLongDistance
                  ? 'Long Distance Pickup'
                  : getSurchargeText(distanceData.distance, distanceData.surcharge)}
              </p>
              <p className={`text-xs mt-1 ${
                distanceData.isLongDistance ? 'text-blue-700' :
                distanceData.surcharge === 0 ? 'text-green-700' : 
                'text-orange-700'
              }`}>
                {distanceData.isLongDistance 
                  ? `Driver ${distanceData.driverName || 'Unknown'} proposed ₱${distanceData.proposedFare} for this ${distanceData.distance.toFixed(1)}km pickup distance`
                  : distanceData.surcharge === 0 
                    ? 'No additional charge for nearby pickup'
                    : 'Distance surcharge helps compensate driver for longer pickup trips'
                }
              </p>
              
              {distanceData.lateNightInfo?.isLateNight && (
                <p className="text-xs mt-2 text-purple-700 bg-purple-100 px-2 py-1 rounded">
                  Late night rates applied: {distanceData.lateNightInfo.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {distanceData.isLongDistance && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
            <div className="flex items-center space-x-2">
              <i className="ri-shield-check-line text-yellow-600"></i>
              <span className="text-sm font-medium text-yellow-800">Dispatcher Review</span>
            </div>
            <p className="text-xs text-yellow-700 mt-1">
              This fare will be reviewed by dispatcher after trip completion to ensure fairness
            </p>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={() => handleConfirm(true)}
            disabled={loading}
            className="w-full bg-orange-500 text-white py-4 rounded-xl font-semibold hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {loading ? 'Processing...' : 
             distanceData.isLongDistance ? `Accept ₱${distanceData.proposedFare}` : 
             `Confirm ₱${distanceData.totalFare}`}
          </button>
          
          <button
            onClick={() => handleConfirm(false)}
            disabled={loading}
            className="w-full bg-gray-200 text-gray-800 py-3 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
          >
            Cancel Booking
          </button>
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">
            {serviceType === 'ride' ? 'Ride' : 'Delivery'} fare includes pickup distance compensation
            {distanceData.lateNightInfo?.isLateNight && " and late night adjustments"}
          </p>
        </div>
      </div>
    </div>
  );
}



