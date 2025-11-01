'use client';

import { useState, useEffect } from 'react';

interface FreeRideData {
  hasValidCredit: boolean;
  creditAmount: number;
  expiresAt: string | null;
  isExpired: boolean;
  isUsed: boolean;
}

export default function FreeRideNotification() {
  const [freeRideData, setFreeRideData] = useState<FreeRideData | null>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkFreeRideEligibility();
  }, []);

  const checkFreeRideEligibility = async () => {
    try {
      const token = localStorage.getItem('j-ride-token');
      const user = JSON.parse(localStorage.getItem('j-ride-user') || '{}');

      if (!token || !user.id) {
        setLoading(false);
        return;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/referral-system`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'check_free_ride_eligibility',
          userId: user.id
        })
      });

      const data = await response.json();
      if (data.success) {
        setFreeRideData(data);
        setShowNotification(data.hasValidCredit);
      }
    } catch (error) {
      console.error('Error checking free ride eligibility:', error);
    }
    setLoading(false);
  };

  const formatTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) return 'Expired';
    if (diffDays === 1) return '1 day left';
    return `${diffDays} days left`;
  };

  if (loading || !freeRideData || !showNotification) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-green-400 to-emerald-500 rounded-2xl p-4 text-white relative overflow-hidden mb-4">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-2 right-2 w-12 h-12 border-2 border-white rounded-full"></div>
        <div className="absolute bottom-2 left-2 w-8 h-8 border-2 border-white rounded-full"></div>
      </div>

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <i className="ri-gift-line text-2xl"></i>
            </div>
            <div>
              <h3 className="font-bold text-lg">FREE Ride Available!</h3>
              <p className="text-sm opacity-90">Welcome bonus from referral</p>
            </div>
          </div>
          <button
            onClick={() => setShowNotification(false)}
            className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            <i className="ri-close-line"></i>
          </button>
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold">Free Ride Credit</span>
            <span className="text-2xl font-bold">â‚±{freeRideData.creditAmount}</span>
          </div>
          
          {freeRideData.expiresAt && (
            <div className="flex items-center justify-between text-sm">
              <span className="opacity-80">Valid until:</span>
              <span className="font-medium">
                {formatTimeRemaining(freeRideData.expiresAt)}
              </span>
            </div>
          )}
        </div>

        <div className="bg-yellow-400/20 border border-yellow-400/30 rounded-lg p-3 mb-3">
          <div className="flex items-start space-x-2">
            <i className="ri-information-line text-yellow-200 mt-0.5"></i>
            <div>
              <p className="text-sm font-medium">How to use your free ride:</p>
              <ul className="text-xs opacity-90 mt-1 space-y-1">
                <li>â€¢ Book any ride up to â‚±{freeRideData.creditAmount}</li>
                <li>â€¢ Select "Free Ride Credit" as payment method</li>
                <li>â€¢ Credit expires in {freeRideData.expiresAt ? formatTimeRemaining(freeRideData.expiresAt) : 'soon'}</li>
                <li>â€¢ Can only be used once</li>
              </ul>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setShowNotification(false);
            // Navigate to ride booking
            window.location.href = '/ride';
          }}
          className="w-full bg-white text-green-600 py-3 rounded-xl font-bold hover:bg-gray-100 transition-colors"
        >
          Book Your FREE Ride Now
        </button>
      </div>
    </div>
  );
}



