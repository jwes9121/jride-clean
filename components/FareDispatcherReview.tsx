'use client';

interface FareDispatcherReviewProps {
  isOpen: boolean;
  onClose: () => void;
  onApprove: (approved: boolean, adjustedFare?: number) => void;
  fareData: {
    rideId: string;
    originalFare: number;
    proposedFare: number;
    distance: number;
    driverName: string;
    passengerName: string;
    pickupLocation: string;
    destinationLocation: string;
    serviceType: 'ride' | 'delivery';
  };
}

export default function FareDispatcherReview({
  isOpen,
  onClose,
  onApprove,
  fareData
}: FareDispatcherReviewProps) {
  if (!isOpen) return null;

  const recommendedFare = Math.max(
    fareData.originalFare + Math.ceil((fareData.distance - 4) / 0.5) * 10,
    fareData.originalFare + 40
  );

  const fareVariance = ((fareData.proposedFare - recommendedFare) / recommendedFare * 100);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full mx-auto mb-4 flex items-center justify-center">
            <i className="ri-shield-check-line text-2xl text-blue-600"></i>
          </div>
          <h3 className="text-xl font-bold">Fare Review Required</h3>
          <p className="text-sm text-gray-600 mt-2">
            Long-distance pickup fare needs approval
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Driver:</span>
              <p className="font-medium">{fareData.driverName}</p>
            </div>
            <div>
              <span className="text-gray-600">Passenger:</span>
              <p className="font-medium">{fareData.passengerName}</p>
            </div>
            <div className="col-span-2">
              <span className="text-gray-600">Route:</span>
              <p className="font-medium">{fareData.pickupLocation} â†’ {fareData.destinationLocation}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div className="bg-white border rounded-xl p-4">
            <h4 className="font-semibold mb-3">Fare Analysis</h4>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Pickup Distance:</span>
                <span className="font-medium">{fareData.distance.toFixed(1)}km</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">Base {fareData.serviceType} fare:</span>
                <span className="font-medium">â‚±{fareData.originalFare}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">System recommended:</span>
                <span className="font-medium text-blue-600">â‚±{recommendedFare}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">Driver proposed:</span>
                <span className={`font-medium ${
                  Math.abs(fareVariance) <= 20 ? 'text-green-600' : 
                  Math.abs(fareVariance) <= 40 ? 'text-orange-600' : 'text-red-600'
                }`}>
                  â‚±{fareData.proposedFare}
                </span>
              </div>
              
              <div className="flex justify-between pt-2 border-t">
                <span className="font-semibold">Variance:</span>
                <span className={`font-semibold ${
                  Math.abs(fareVariance) <= 20 ? 'text-green-600' : 
                  Math.abs(fareVariance) <= 40 ? 'text-orange-600' : 'text-red-600'
                }`}>
                  {fareVariance > 0 ? '+' : ''}{fareVariance.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          <div className={`rounded-lg p-4 ${
            Math.abs(fareVariance) <= 20 ? 'bg-green-50 border border-green-200' :
            Math.abs(fareVariance) <= 40 ? 'bg-orange-50 border border-orange-200' :
            'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-start space-x-3">
              <i className={`mt-0.5 ${
                Math.abs(fareVariance) <= 20 ? 'ri-check-line text-green-600' :
                Math.abs(fareVariance) <= 40 ? 'ri-alert-line text-orange-600' :
                'ri-error-warning-line text-red-600'
              }`}></i>
              <div>
                <p className={`text-sm font-medium ${
                  Math.abs(fareVariance) <= 20 ? 'text-green-800' :
                  Math.abs(fareVariance) <= 40 ? 'text-orange-800' :
                  'text-red-800'
                }`}>
                  {Math.abs(fareVariance) <= 20 ? 'Fair Pricing' :
                   Math.abs(fareVariance) <= 40 ? 'Moderate Variance' :
                   'High Variance'}
                </p>
                <p className={`text-xs mt-1 ${
                  Math.abs(fareVariance) <= 20 ? 'text-green-700' :
                  Math.abs(fareVariance) <= 40 ? 'text-orange-700' :
                  'text-red-700'
                }`}>
                  {Math.abs(fareVariance) <= 20 ? 'Proposed fare is within reasonable range' :
                   Math.abs(fareVariance) <= 40 ? 'Fare differs from system recommendation' :
                   'Significant difference from recommended fare - review carefully'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => onApprove(true)}
            className="w-full bg-green-500 text-white py-4 rounded-xl font-semibold hover:bg-green-600 transition-colors"
          >
            Approve â‚±{fareData.proposedFare}
          </button>
          
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onApprove(true, recommendedFare)}
              className="bg-blue-500 text-white py-3 rounded-xl font-semibold hover:bg-blue-600 transition-colors text-sm"
            >
              Adjust to â‚±{recommendedFare}
            </button>
            
            <button
              onClick={() => onApprove(false)}
              className="bg-red-500 text-white py-3 rounded-xl font-semibold hover:bg-red-600 transition-colors text-sm"
            >
              Reject Fare
            </button>
          </div>
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">
            Approved fares will be stored for future fare intelligence
          </p>
        </div>
      </div>
    </div>
  );
}



