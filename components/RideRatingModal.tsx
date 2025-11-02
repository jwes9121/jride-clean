'use client';

import { useState } from 'react';

interface RideRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (rating: number, feedback: string) => void;
  driverName: string;
  rideId: string;
}

export default function RideRatingModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  driverName, 
  rideId 
}: RideRatingModalProps) {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [hoveredRating, setHoveredRating] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(rating, feedback);
      onClose();
      // Reset form
      setRating(0);
      setFeedback('');
      setHoveredRating(0);
    } catch (error) {
      console.error('Error submitting rating:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRatingText = (stars: number) => {
    switch (stars) {
      case 1: return 'Poor';
      case 2: return 'Fair';
      case 3: return 'Good';
      case 4: return 'Very Good';
      case 5: return 'Excellent';
      default: return 'Rate your experience';
    }
  };

  const getRatingColor = (stars: number) => {
    if (stars <= 2) return 'text-red-500';
    if (stars === 3) return 'text-yellow-500';
    if (stars === 4) return 'text-blue-500';
    return 'text-green-500';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50">
      <div className="bg-white w-full rounded-t-2xl p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">Rate Your Ride</h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-all duration-200"
          >
            <i className="ri-close-line text-xl"></i>
          </button>
        </div>

        {/* Driver Info */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <i className="ri-user-line text-2xl text-blue-600"></i>
          </div>
          <h4 className="font-semibold text-gray-900">How was your ride with {driverName}?</h4>
          <p className="text-sm text-gray-600">Your feedback helps improve our service</p>
        </div>

        {/* Star Rating */}
        <div className="text-center mb-6">
          <div className="flex justify-center space-x-2 mb-3">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoveredRating(star)}
                onMouseLeave={() => setHoveredRating(0)}
                className="text-4xl transition-all duration-200 hover:scale-110"
              >
                <i 
                  className={`ri-star-${
                    (hoveredRating || rating) >= star ? 'fill' : 'line'
                  } ${
                    (hoveredRating || rating) >= star 
                      ? 'text-yellow-400' 
                      : 'text-gray-300'
                  }`}
                ></i>
              </button>
            ))}
          </div>
          
          <p className={`text-lg font-medium ${getRatingColor(hoveredRating || rating)}`}>
            {getRatingText(hoveredRating || rating)}
          </p>
        </div>

        {/* Quick Feedback Options */}
        {rating > 0 && (
          <div className="mb-6">
            <p className="text-sm font-medium text-gray-700 mb-3">Quick feedback (optional):</p>
            <div className="grid grid-cols-2 gap-2">
              {rating >= 4 ? (
                // Positive feedback options
                <>
                  <button 
                    onClick={() => setFeedback('Professional and courteous driver')}
                    className={`p-3 text-sm rounded-lg border transition-colors ${
                      feedback === 'Professional and courteous driver'
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  >
                    Professional & Courteous
                  </button>
                  <button 
                    onClick={() => setFeedback('Clean and comfortable vehicle')}
                    className={`p-3 text-sm rounded-lg border transition-colors ${
                      feedback === 'Clean and comfortable vehicle'
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  >
                    Clean Vehicle
                  </button>
                  <button 
                    onClick={() => setFeedback('On time pickup and arrival')}
                    className={`p-3 text-sm rounded-lg border transition-colors ${
                      feedback === 'On time pickup and arrival'
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  >
                    On Time
                  </button>
                  <button 
                    onClick={() => setFeedback('Safe and smooth driving')}
                    className={`p-3 text-sm rounded-lg border transition-colors ${
                      feedback === 'Safe and smooth driving'
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  >
                    Safe Driving
                  </button>
                </>
              ) : (
                // Negative feedback options
                <>
                  <button 
                    onClick={() => setFeedback('Driver was late for pickup')}
                    className={`p-3 text-sm rounded-lg border transition-colors ${
                      feedback === 'Driver was late for pickup'
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  >
                    Late Pickup
                  </button>
                  <button 
                    onClick={() => setFeedback('Vehicle condition needs improvement')}
                    className={`p-3 text-sm rounded-lg border transition-colors ${
                      feedback === 'Vehicle condition needs improvement'
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  >
                    Vehicle Condition
                  </button>
                  <button 
                    onClick={() => setFeedback('Unprofessional behavior')}
                    className={`p-3 text-sm rounded-lg border transition-colors ${
                      feedback === 'Unprofessional behavior'
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  >
                    Unprofessional
                  </button>
                  <button 
                    onClick={() => setFeedback('Unsafe driving practices')}
                    className={`p-3 text-sm rounded-lg border transition-colors ${
                      feedback === 'Unsafe driving practices'
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  >
                    Unsafe Driving
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Custom Feedback */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Additional Comments (Optional)
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Tell us more about your experience..."
            className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={3}
            maxLength={500}
          />
          <p className="text-xs text-gray-500 mt-1">{feedback.length}/500 characters</p>
        </div>

        {/* Submit Buttons */}
        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
          >
            Skip Rating
          </button>
          <button
            onClick={handleSubmit}
            disabled={rating === 0 || isSubmitting}
            className={`flex-1 py-3 rounded-xl font-semibold transition-colors ${
              rating === 0 || isSubmitting
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Submitting...</span>
              </div>
            ) : (
              'Submit Rating'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}



