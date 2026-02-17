"use client";
import React, { useState, useEffect } from 'react';
interface BookingFormProps {
  onBookingCreated: (booking: any) => void;
}

export default function BookingForm({ onBookingCreated }: BookingFormProps) {
  const [formData, setFormData] = useState({
    passengerName: '',
    passengerPhone: '',
    pickupLocation: '',
    dropoffLocation: '',
    fare: '',
    notes: '',
    assignedDriver: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fareCalculation, setFareCalculation] = useState<{
    baseFare: number;
    distanceFare: number;
    total: number;
  } | null>(null);

  const availableDrivers = [
    { id: '1', name: 'Juan Santos', vehicle: 'Tricycle #101', distance: '0.5 km' },
    { id: '3', name: 'Pedro Reyes', vehicle: 'Tricycle #303', distance: '1.2 km' },
    { id: '5', name: 'Carlos Mendoza', vehicle: 'Tricycle #205', distance: '2.1 km' }
  ];

  const handleLocationChange = (field: 'pickupLocation' | 'dropoffLocation', value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Auto-calculate fare when both locations are filled
    if (formData.pickupLocation && formData.dropoffLocation && field === 'dropoffLocation') {
      const baseFare = 15;
      const distanceFare = Math.floor(Math.random() * 20) + 10; // Simulate distance calculation
      const total = baseFare + distanceFare;
      
      setFareCalculation({ baseFare, distanceFare, total });
      setFormData(prev => ({ ...prev, fare: total.toString() }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const booking = {
        id: Date.now().toString(),
        ...formData,
        status: 'pending',
        createdAt: new Date().toISOString(),
        type: 'dispatcher_booking',
        dispatcherId: localStorage.getItem('dispatcher_id')
      };

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      onBookingCreated(booking);
      
      // Reset form
      setFormData({
        passengerName: '',
        passengerPhone: '',
        pickupLocation: '',
        dropoffLocation: '',
        fare: '',
        notes: '',
        assignedDriver: ''
      });
      setFareCalculation(null);
      
    } catch (error) {
      console.error('Booking creation failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border p-6">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <i className="ri-add-circle-line text-blue-600 text-xl"></i>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Manual Booking</h2>
            <p className="text-sm text-gray-500">Create booking from call/message</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Passenger Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-900 flex items-center">
              <i className="ri-user-line text-gray-400 mr-2"></i>
              Passenger Information
            </h3>
            
            <div>
              <input
                type="text"
                value={formData.passengerName}
                onChange={(e) => setFormData(prev => ({ ...prev, passengerName: e.target.value }))}
                placeholder="Passenger name (or 'Guest')"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            
            <div>
              <input
                type="tel"
                value={formData.passengerPhone}
                onChange={(e) => setFormData(prev => ({ ...prev, passengerPhone: e.target.value }))}
                placeholder="Phone number (optional)"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Location Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-900 flex items-center">
              <i className="ri-map-pin-line text-gray-400 mr-2"></i>
              Trip Details
            </h3>
            
            <div className="relative">
              <div className="absolute left-3 top-3">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              </div>
              <input
                type="text"
                value={formData.pickupLocation}
                onChange={(e) => handleLocationChange('pickupLocation', e.target.value)}
                placeholder="Pickup location"
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            
            <div className="relative">
              <div className="absolute left-3 top-3">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
              </div>
              <input
                type="text"
                value={formData.dropoffLocation}
                onChange={(e) => handleLocationChange('dropoffLocation', e.target.value)}
                placeholder="Drop-off location"
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>

          {/* Fare Calculation */}
          {fareCalculation && (
            <div className="bg-blue-50 rounded-xl p-4">
              <h4 className="text-sm font-medium text-blue-900 mb-2">Fare Calculation</h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-blue-700">Base fare:</span>
                  <span className="font-medium">Ã¢â€šÂ±{fareCalculation.baseFare}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-700">Distance fare:</span>
                  <span className="font-medium">Ã¢â€šÂ±{fareCalculation.distanceFare}</span>
                </div>
                <div className="border-t border-blue-200 pt-1 flex justify-between font-semibold">
                  <span className="text-blue-900">Total:</span>
                  <span className="text-blue-900">Ã¢â€šÂ±{fareCalculation.total}</span>
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Fare Amount</label>
              <button
                type="button"
                onClick={() => {
                  const baseFare = 15;
                  const distanceFare = Math.floor(Math.random() * 20) + 10;
                  const total = baseFare + distanceFare;
                  setFormData(prev => ({ ...prev, fare: total.toString() }));
                }}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Auto-calculate
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-3 text-gray-500">Ã¢â€šÂ±</span>
              <input
                type="number"
                value={formData.fare}
                onChange={(e) => setFormData(prev => ({ ...prev, fare: e.target.value }))}
                placeholder="0.00"
                className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                min="0"
                step="0.01"
              />
            </div>
          </div>

          {/* Driver Assignment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assign Driver (Optional)
            </label>
            <select
              value={formData.assignedDriver}
              onChange={(e) => setFormData(prev => ({ ...prev, assignedDriver: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="">Auto-assign nearest driver</option>
              {availableDrivers.map(driver => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} - {driver.vehicle} ({driver.distance} away)
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional instructions or notes..."
              rows={3}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              maxLength={500}
            />
            <p className="text-xs text-gray-500 mt-1">{formData.notes.length}/500 characters</p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 text-white py-4 px-4 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                Creating Booking...
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <i className="ri-send-plane-line mr-2"></i>
                Create Booking
              </div>
            )}
          </button>
        </form>

        {/* Quick Actions */}
        <div className="mt-6 pt-4 border-t">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Quick Actions</h4>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setFormData(prev => ({ ...prev, passengerName: 'Guest' }))}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
            >
              Set as Guest
            </button>
            <button
              type="button"
              onClick={() => {
                setFormData({
                  passengerName: '',
                  passengerPhone: '',
                  pickupLocation: '',
                  dropoffLocation: '',
                  fare: '',
                  notes: '',
                  assignedDriver: ''
                });
                setFareCalculation(null);
              }}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
            >
              Clear Form
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}







