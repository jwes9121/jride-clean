
'use client';

import { useState } from 'react';

export default function LocationSection() {
  const [currentLocation, setCurrentLocation] = useState('Lagawe');

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Your Location</h2>
        <div className="bg-white rounded-xl p-3 flex items-center justify-between shadow-sm border">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
              <i className="ri-map-pin-line text-orange-600"></i>
            </div>
            <span className="text-gray-800 font-medium">{currentLocation}</span>
          </div>
          <button className="text-orange-600">
            <i className="ri-arrow-down-s-line"></i>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl overflow-hidden shadow-sm border">
        <div className="h-48 bg-gray-200 relative">
          <iframe
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3849.123!2d121.123!3d16.789!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMTbCsDQ3JzIwLjAiTiAxMjHCsDA3JzIzLjAiRQ!5e0!3m2!1sen!2sph!4v1234567890"
            width="100%"
            height="100%"
            style={{ border: 0 }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <div className="absolute top-3 right-3">
            <button className="bg-white p-2 rounded-lg shadow-md">
              <i className="ri-fullscreen-line text-gray-600"></i>
            </button>
          </div>
        </div>
        
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center">
                <i className="ri-map-pin-fill text-white text-xs"></i>
              </div>
              <span className="text-sm font-medium">Be a J-Rider!</span>
            </div>
            <button className="text-orange-600 text-sm font-medium">
              Set Pin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



