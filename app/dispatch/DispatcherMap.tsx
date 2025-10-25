"use client";
import React, { useState, useEffect } from 'react';
interface Driver {
  id: string;
  name: string;
  status: 'available' | 'on-trip' | 'offline';
  location: {
    lat: number;
    lng: number;
  };
  vehicle: string;
  rating: number;
  trips_today: number;
}

interface DispatcherMapProps {
  pendingBookings: any[];
  activeTrips: any[];
}

export default function DispatcherMap({ pendingBookings, activeTrips }: DispatcherMapProps) {
  const [drivers, setDrivers] = useState<Driver[]>([
    {
      id: '1',
      name: 'Juan Santos',
      status: 'available',
      location: { lat: 14.5995, lng: 120.9842 },
      vehicle: 'Tricycle #101',
      rating: 4.8,
      trips_today: 12
    },
    {
      id: '2',
      name: 'Maria Cruz',
      status: 'on-trip',
      location: { lat: 14.6042, lng: 120.9822 },
      vehicle: 'Tricycle #205',
      rating: 4.9,
      trips_today: 8
    },
    {
      id: '3',
      name: 'Pedro Reyes',
      status: 'available',
      location: { lat: 14.5985, lng: 120.9890 },
      vehicle: 'Tricycle #303',
      rating: 4.7,
      trips_today: 15
    },
    {
      id: '4',
      name: 'Ana Garcia',
      status: 'offline',
      location: { lat: 14.6000, lng: 120.9800 },
      vehicle: 'Tricycle #124',
      rating: 4.6,
      trips_today: 6
    }
  ]);

  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'available' | 'on-trip' | 'offline'>('all');

  const filteredDrivers = filterStatus === 'all' 
    ? drivers 
    : drivers.filter(driver => driver.status === filterStatus);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-green-500';
      case 'on-trip': return 'bg-yellow-500';
      case 'offline': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'available': return 'Available';
      case 'on-trip': return 'On Trip';
      case 'offline': return 'Offline';
      default: return 'Unknown';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      {/* Filter Bar */}
      <div className="bg-white border-b p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Live Driver Tracking</h2>
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span>Auto-refresh</span>
          </div>
        </div>
        
        <div className="flex space-x-2 overflow-x-auto">
          {(['all', 'available', 'on-trip', 'offline'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                filterStatus === status
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {status === 'all' ? 'All Drivers' : getStatusText(status)}
              {status !== 'all' && (
                <span className="ml-1">
                  ({drivers.filter(d => d.status === status).length})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Map Area */}
      <div className="flex-1 relative bg-gray-100">
        <iframe
          src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3861.2396836937814!2d120.98168!3d14.5995!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMTTCsDM1JzU4LjIiTiAxMjDCsDU4JzU0LjEiRQ!5e0!3m2!1sen!2sph!4v1234567890"
          width="100%"
          height="100%"
          style={{ border: 0 }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="absolute inset-0"
        ></iframe>

        {/* Driver Status Overlay */}
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-3 max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-900">Driver Status</h3>
            <i className="ri-refresh-line text-gray-400 text-sm"></i>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                <span>Available</span>
              </div>
              <span className="font-medium">{drivers.filter(d => d.status === 'available').length}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></div>
                <span>On Trip</span>
              </div>
              <span className="font-medium">{drivers.filter(d => d.status === 'on-trip').length}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-gray-400 rounded-full mr-2"></div>
                <span>Offline</span>
              </div>
              <span className="font-medium">{drivers.filter(d => d.status === 'offline').length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Driver List */}
      <div className="bg-white border-t max-h-64 overflow-y-auto">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="text-sm font-medium text-gray-900">Drivers ({filteredDrivers.length})</h3>
        </div>
        
        <div className="divide-y">
          {filteredDrivers.map((driver) => (
            <div
              key={driver.id}
              onClick={() => setSelectedDriver(driver)}
              className="p-4 hover:bg-gray-50 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="relative">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <i className="ri-user-line text-blue-600"></i>
                    </div>
                    <div className={`absolute -bottom-1 -right-1 w-4 h-4 ${getStatusColor(driver.status)} rounded-full border-2 border-white`}></div>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{driver.name}</p>
                    <p className="text-xs text-gray-500">{driver.vehicle}</p>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="flex items-center space-x-1 mb-1">
                    <i className="ri-star-fill text-yellow-400 text-xs"></i>
                    <span className="text-xs font-medium">{driver.rating}</span>
                  </div>
                  <p className="text-xs text-gray-500">{driver.trips_today} trips</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Driver Detail Modal */}
      {selectedDriver && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
          <div className="bg-white rounded-t-3xl w-full max-w-md max-h-96 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Driver Details</h3>
                <button
                  onClick={() => setSelectedDriver(null)}
                  className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center"
                >
                  <i className="ri-close-line text-gray-600"></i>
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <i className="ri-user-line text-blue-600 text-xl"></i>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{selectedDriver.name}</p>
                    <p className="text-sm text-gray-500">{selectedDriver.vehicle}</p>
                    <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      selectedDriver.status === 'available' ? 'bg-green-100 text-green-700' :
                      selectedDriver.status === 'on-trip' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      <div className={`w-2 h-2 ${getStatusColor(selectedDriver.status)} rounded-full mr-1`}></div>
                      {getStatusText(selectedDriver.status)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center space-x-2 mb-1">
                      <i className="ri-star-fill text-yellow-400 text-sm"></i>
                      <span className="text-sm font-medium">Rating</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{selectedDriver.rating}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center space-x-2 mb-1">
                      <i className="ri-road-map-line text-blue-600 text-sm"></i>
                      <span className="text-sm font-medium">Today</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{selectedDriver.trips_today}</p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setSelectedDriver(null);
                    // Navigate to booking form with pre-selected driver
                  }}
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 transition-colors"
                  disabled={selectedDriver.status !== 'available'}
                >
                  {selectedDriver.status === 'available' ? 'Assign Booking' : 'Driver Not Available'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}







