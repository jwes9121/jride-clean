'use client';

import { useState, useEffect } from 'react';

interface PanicButtonProps {
  userId: string;
  userType: 'passenger' | 'driver';
  rideId?: string;
  onPanicTriggered?: () => void;
}

export default function PanicButton({ userId, userType, rideId, onPanicTriggered }: PanicButtonProps) {
  const [showPanicOptions, setShowPanicOptions] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);

  useEffect(() => {
    // Get current location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => console.log('Location error:', error)
      );
    }
  }, []);

  const emergencyOptions = [
    {
      type: 'panic',
      title: 'Emergency Help!',
      description: 'I need immediate assistance',
      icon: 'ri-alarm-warning-line',
      color: 'bg-red-500',
      priority: 'critical'
    },
    {
      type: 'safety_concern',
      title: 'Safety Concern',
      description: 'I feel unsafe in this situation',
      icon: 'ri-shield-line',
      color: 'bg-orange-500',
      priority: 'high'
    },
    {
      type: 'medical',
      title: 'Medical Emergency',
      description: 'Someone needs medical attention',
      icon: 'ri-health-book-line',
      color: 'bg-pink-500',
      priority: 'critical'
    },
    {
      type: 'accident',
      title: 'Accident',
      description: 'There has been an accident',
      icon: 'ri-car-line',
      color: 'bg-yellow-500',
      priority: 'high'
    }
  ];

  const triggerEmergency = async (emergencyType: string, description: string) => {
    if (!currentLocation) {
      alert('Unable to get your location. Please enable location services.');
      return;
    }

    setIsTriggering(true);

    try {
      const token = localStorage.getItem('j-ride-token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/emergency-panic-system`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'trigger_panic_alert',
          userId: userId,
          userType: userType,
          rideId: rideId,
          latitude: currentLocation.lat,
          longitude: currentLocation.lng,
          emergencyType: emergencyType,
          description: description
        })
      });

      const result = await response.json();
      
      if (result.success) {
        alert(`Emergency alert sent! ${result.message}`);
        setShowPanicOptions(false);
        onPanicTriggered?.();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Emergency alert error:', error);
      alert('Failed to send emergency alert. Please call dispatcher directly.');
    } finally {
      setIsTriggering(false);
    }
  };

  const quickCallDispatcher = async () => {
    try {
      const token = localStorage.getItem('j-ride-token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/emergency-panic-system`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'quick_call_dispatcher',
          userId: userId,
          rideId: rideId,
          urgencyLevel: 'normal'
        })
      });

      const result = await response.json();
      
      if (result.success) {
        // Direct call to dispatcher
        window.location.href = `tel:${result.dispatcher.phone}`;
      }
    } catch (error) {
      console.error('Quick call error:', error);
      // Fallback to default dispatcher number
      window.location.href = 'tel:+639123456789';
    }
  };

  if (showPanicOptions) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-end z-50">
        <div className="bg-white w-full rounded-t-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-red-600">Emergency Assistance</h3>
            <button 
              onClick={() => setShowPanicOptions(false)}
              className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full"
            >
              <i className="ri-close-line text-xl"></i>
            </button>
          </div>

          <div className="space-y-4 mb-6">
            {emergencyOptions.map((option) => (
              <button
                key={option.type}
                onClick={() => triggerEmergency(option.type, option.description)}
                disabled={isTriggering}
                className={`w-full p-4 rounded-xl ${option.color} text-white text-left hover:opacity-90 transition-opacity disabled:opacity-50`}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                    <i className={`${option.icon} text-xl`}></i>
                  </div>
                  <div>
                    <h4 className="font-semibold">{option.title}</h4>
                    <p className="text-sm opacity-90">{option.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="border-t pt-4">
            <button
              onClick={quickCallDispatcher}
              className="w-full bg-blue-500 text-white py-3 rounded-xl font-semibold hover:bg-blue-600 transition-colors flex items-center justify-center space-x-2"
            >
              <i className="ri-phone-line"></i>
              <span>Quick Call Dispatcher</span>
            </button>
          </div>

          {isTriggering && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
              <div className="bg-white p-6 rounded-xl text-center">
                <div className="animate-spin w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-600">Sending emergency alert...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowPanicOptions(true)}
      className="fixed bottom-24 right-4 w-14 h-14 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-colors z-30 flex items-center justify-center"
      title="Emergency Help"
    >
      <i className="ri-alarm-warning-line text-xl"></i>
    </button>
  );
}



