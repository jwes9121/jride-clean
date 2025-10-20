'use client';

import { useState, useEffect } from 'react';

interface DeliveryOrder {
  id: string;
  vendor_name: string;
  vendor_address: string;
  customer_address: string;
  status: string;
  driver_name?: string;
  driver_phone?: string;
  driver_location?: {
    lat: number;
    lng: number;
  };
  estimated_arrival?: string;
  total_amount: number;
}

interface DeliveryTrackerProps {
  order: DeliveryOrder;
  onClose: () => void;
}

export default function DeliveryTracker({ order, onClose }: DeliveryTrackerProps) {
  const [driverLocation, setDriverLocation] = useState(order.driver_location || { lat: 16.789, lng: 121.123 });
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);

  useEffect(() => {
    // Simulate driver location updates
    const interval = setInterval(() => {
      setDriverLocation(prev => ({
        lat: prev.lat + (Math.random() - 0.5) * 0.001,
        lng: prev.lng + (Math.random() - 0.5) * 0.001
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const getStatusSteps = () => {
    const statuses = [
      { key: 'driver_assigned', label: 'Driver Assigned', icon: 'ri-user-check-line' },
      { key: 'driver_en_route', label: 'Driver En Route', icon: 'ri-roadster-line' },
      { key: 'arrived_at_vendor', label: 'At Restaurant', icon: 'ri-store-line' },
      { key: 'pickup_verified', label: 'Food Picked Up', icon: 'ri-shopping-bag-line' },
      { key: 'on_the_way', label: 'On the Way', icon: 'ri-truck-line' },
      { key: 'arrived_at_customer', label: 'Driver Arrived', icon: 'ri-map-pin-check-line' },
      { key: 'delivered', label: 'Delivered', icon: 'ri-check-double-line' }
    ];

    const currentIndex = statuses.findIndex(s => s.key === order.status);
    
    return statuses.map((status, index) => ({
      ...status,
      completed: index <= currentIndex,
      active: index === currentIndex
    }));
  };

  const handleCallDriver = () => {
    if (order.driver_phone) {
      window.location.href = `tel:${order.driver_phone}`;
    } else {
      setIsCallModalOpen(true);
    }
  };

  const statusSteps = getStatusSteps();

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white p-4 border-b flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center">
            <i className="ri-arrow-left-line text-xl"></i>
          </button>
          <div>
            <h1 className="text-xl font-bold">Track Order</h1>
            <p className="text-sm text-gray-600">#{order.id.slice(-8)}</p>
          </div>
        </div>
        
        <button
          onClick={handleCallDriver}
          className="bg-green-500 text-white px-4 py-2 rounded-xl font-semibold hover:bg-green-600 flex items-center space-x-2"
        >
          <i className="ri-phone-line"></i>
          <span>Call Driver</span>
        </button>
      </div>

      {/* Map Area */}
      <div className="flex-1 relative">
        <iframe
          src={`https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3849.123!2d${driverLocation.lng}!3d${driverLocation.lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2z${driverLocation.lat}Â°${driverLocation.lng}Â°!5e0!3m2!1sen!2sph!4v1234567890`}
          width="100%"
          height="100%"
          style={{ border: 0 }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        
        {/* Driver Location Marker */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <div className="relative">
            <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center shadow-lg animate-pulse">
              <i className="ri-truck-fill text-white text-xl"></i>
            </div>
            <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black text-white px-2 py-1 rounded text-xs whitespace-nowrap">
              {order.driver_name || 'Driver'}
            </div>
          </div>
        </div>

        {/* Floating Status Card */}
        <div className="absolute top-4 left-4 right-4 bg-white rounded-xl p-4 shadow-lg border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <i className="ri-restaurant-line text-orange-600"></i>
              </div>
              <div>
                <div className="font-semibold">{order.vendor_name}</div>
                <div className="text-sm text-gray-600">â‚±{order.total_amount}</div>
              </div>
            </div>
            
            {order.estimated_arrival && (
              <div className="text-right">
                <div className="text-sm font-semibold text-green-600">
                  {new Date(order.estimated_arrival).toLocaleTimeString()}
                </div>
                <div className="text-xs text-gray-500">ETA</div>
              </div>
            )}
          </div>
          
          <div className="bg-orange-50 px-3 py-2 rounded-lg">
            <div className="text-sm font-medium text-orange-800">
              {statusSteps.find(s => s.active)?.label || 'In Progress'}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status Panel */}
      <div className="bg-white border-t p-4 max-h-64 overflow-y-auto">
        <div className="mb-4">
          <h3 className="font-semibold mb-3">Delivery Progress</h3>
          
          <div className="space-y-4">
            {statusSteps.map((step, index) => (
              <div key={step.key} className="flex items-center space-x-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  step.completed 
                    ? 'bg-green-500 text-white' 
                    : step.active 
                      ? 'bg-orange-500 text-white' 
                      : 'bg-gray-200 text-gray-400'
                }`}>
                  <i className={step.icon}></i>
                </div>
                
                <div className="flex-1">
                  <div className={`font-medium ${
                    step.completed 
                      ? 'text-green-700' 
                      : step.active 
                        ? 'text-orange-700' 
                        : 'text-gray-500'
                  }`}>
                    {step.label}
                  </div>
                  
                  {step.active && (
                    <div className="text-sm text-gray-600 mt-1">
                      {step.key === 'driver_assigned' && 'Driver is heading to restaurant'}
                      {step.key === 'driver_en_route' && 'Driver is on the way to restaurant'}
                      {step.key === 'arrived_at_vendor' && 'Driver has arrived at restaurant'}
                      {step.key === 'pickup_verified' && 'Food has been picked up'}
                      {step.key === 'on_the_way' && 'Driver is heading to your location'}
                      {step.key === 'arrived_at_customer' && 'Driver has arrived at your location'}
                      {step.key === 'delivered' && 'Order delivered successfully'}
                    </div>
                  )}
                </div>
                
                {step.completed && (
                  <div className="text-xs text-gray-500">
                    {new Date().toLocaleTimeString()}
                  </div>
                )}
                
                {step.active && (
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                    <span className="text-xs text-orange-600">Live</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Driver Info */}
        {order.driver_name && (
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <i className="ri-user-line text-blue-600 text-xl"></i>
              </div>
              <div className="flex-1">
                <div className="font-semibold">{order.driver_name}</div>
                <div className="text-sm text-gray-600">Your delivery driver</div>
              </div>
              <button
                onClick={handleCallDriver}
                className="bg-green-500 text-white p-2 rounded-full hover:bg-green-600"
              >
                <i className="ri-phone-line"></i>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Call Modal */}
      {isCallModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <i className="ri-phone-line text-2xl text-green-600"></i>
              </div>
              <h3 className="text-xl font-bold">Contact Driver</h3>
              <p className="text-sm text-gray-600 mt-2">
                Driver contact information not available
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => window.location.href = 'tel:09176543210'}
                className="w-full bg-green-500 text-white py-3 rounded-xl font-semibold hover:bg-green-600"
              >
                Call Support: 09176543210
              </button>
              
              <button
                onClick={() => setIsCallModalOpen(false)}
                className="w-full bg-gray-200 text-gray-700 py-3 rounded-xl font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


