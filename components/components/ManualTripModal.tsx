'use client';

import { useState } from 'react';

interface ManualTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTrip: (tripData: any) => void;
}

export default function ManualTripModal({ isOpen, onClose, onStartTrip }: ManualTripModalProps) {
  const [tripType, setTripType] = useState<'local' | 'out-of-town'>('local');
  const [estimatedFare, setEstimatedFare] = useState(30);
  const [passengerCount, setPassengerCount] = useState(1);
  const [estimatedDuration, setEstimatedDuration] = useState(15);
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const farePresets = {
    local: [30, 50, 80, 100],
    'out-of-town': [150, 200, 300, 500]
  };

  const durationPresets = {
    local: [10, 15, 20, 30],
    'out-of-town': [60, 90, 120, 180]
  };

  const handleStartTrip = () => {
    if (!destination.trim()) {
      alert('Please enter destination');
      return;
    }

    const tripData = {
      type: tripType,
      estimatedFare,
      passengerCount,
      estimatedDuration,
      destination: destination.trim(),
      notes: notes.trim(),
      startTime: new Date().toISOString()
    };

    onStartTrip(tripData);
    onClose();
    
    // Reset form
    setTripType('local');
    setEstimatedFare(30);
    setPassengerCount(1);
    setEstimatedDuration(15);
    setDestination('');
    setNotes('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90%] overflow-y-auto">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Start Manual Trip</h3>
              <p className="text-sm text-gray-600">Walk-in passenger pickup</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
            >
              <i className="ri-close-line text-xl"></i>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-6">
          {/* Trip Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Trip Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setTripType('local');
                  setEstimatedFare(30);
                  setEstimatedDuration(15);
                }}
                className={`p-4 rounded-xl border-2 transition-colors ${
                  tripType === 'local'
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-center">
                  <i className="ri-map-2-line text-2xl mb-2 text-orange-600"></i>
                  <div className="font-semibold">Local</div>
                  <div className="text-xs text-gray-600">Within town</div>
                </div>
              </button>

              <button
                onClick={() => {
                  setTripType('out-of-town');
                  setEstimatedFare(150);
                  setEstimatedDuration(60);
                }}
                className={`p-4 rounded-xl border-2 transition-colors ${
                  tripType === 'out-of-town'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-center">
                  <i className="ri-roadster-line text-2xl mb-2 text-blue-600"></i>
                  <div className="font-semibold">Out-of-Town</div>
                  <div className="text-xs text-gray-600">Long distance</div>
                </div>
              </button>
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Destination</label>
            <div className="relative">
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="Where are you going?"
                required
              />
              <i className="ri-map-pin-line absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
            </div>
          </div>

          {/* Estimated Fare */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Estimated Fare</label>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {farePresets[tripType].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setEstimatedFare(preset)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                    estimatedFare === preset
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  â‚±{preset}
                </button>
              ))}
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-500">â‚±</span>
              <input
                type="number"
                value={estimatedFare}
                onChange={(e) => setEstimatedFare(Number(e.target.value))}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                min="20"
                step="10"
              />
            </div>
          </div>

          {/* Estimated Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Estimated Duration (minutes)</label>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {durationPresets[tripType].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setEstimatedDuration(preset)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                    estimatedDuration === preset
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {preset}m
                </button>
              ))}
            </div>
            <input
              type="number"
              value={estimatedDuration}
              onChange={(e) => setEstimatedDuration(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              min="5"
              step="5"
            />
          </div>

          {/* Passenger Count */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Number of Passengers</label>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Passengers</span>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setPassengerCount(Math.max(1, passengerCount - 1))}
                  className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
                >
                  <i className="ri-subtract-line"></i>
                </button>
                <span className="w-8 text-center font-semibold text-lg">{passengerCount}</span>
                <button
                  onClick={() => setPassengerCount(Math.min(5, passengerCount + 1))}
                  className="w-10 h-10 bg-orange-500 text-white rounded-full flex items-center justify-center hover:bg-orange-600 transition-colors"
                >
                  <i className="ri-add-line"></i>
                </button>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              rows={3}
              placeholder="Any special instructions or landmarks..."
              maxLength={200}
            />
            <div className="text-xs text-gray-500 mt-1">{notes.length}/200 characters</div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 p-4 rounded-xl">
            <h4 className="font-semibold text-gray-800 mb-2">Trip Summary</h4>
            <div className="space-y-1 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Type:</span>
                <span className="font-medium">{tripType === 'local' ? 'Local Trip' : 'Out-of-Town'}</span>
              </div>
              <div className="flex justify-between">
                <span>Estimated Fare:</span>
                <span className="font-medium text-green-600">â‚±{estimatedFare}</span>
              </div>
              <div className="flex justify-between">
                <span>Duration:</span>
                <span className="font-medium">{estimatedDuration} minutes</span>
              </div>
              <div className="flex justify-between">
                <span>Passengers:</span>
                <span className="font-medium">{passengerCount}</span>
              </div>
            </div>
          </div>

          {/* Important Notice */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <div className="flex items-start space-x-2">
              <i className="ri-information-line text-yellow-600 mt-0.5"></i>
              <div className="text-sm text-yellow-800">
                <p className="font-medium mb-1">Important</p>
                <ul className="text-xs space-y-1">
                  <li>â€¢ You'll be marked as "Busy - Manual Trip"</li>
                  <li>â€¢ No new booking requests during this trip</li>
                  <li>â€¢ Remember to end trip when completed</li>
                  <li>â€¢ Dispatcher can monitor your trip status</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStartTrip}
              disabled={!destination.trim()}
              className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-semibold hover:bg-orange-600 transition-colors disabled:bg-gray-300 flex items-center justify-center space-x-2"
            >
              <i className="ri-play-circle-line"></i>
              <span>Start Trip</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


