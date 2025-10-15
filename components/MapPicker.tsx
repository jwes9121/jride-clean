
'use client';

import { useState, useEffect } from 'react';

interface Location {
  address: string;
  lat: number;
  lng: number;
  municipality?: string;
  barangay?: string;
  type?: string;
}

interface MapPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onLocationSelect: (location: Location) => void;
  title?: string;
  pinColor?: 'green' | 'red';
  initialLat?: number;
  initialLng?: number;
  isSignupMode?: boolean;
  initialLocation?: Location;
  context?: string;
}

export default function MapPicker({ 
  isOpen, 
  onClose, 
  onLocationSelect, 
  title = 'Select Location',
  pinColor = 'green',
  initialLat = 16.78,
  initialLng = 121.12,
  isSignupMode = false,
  initialLocation,
  context = 'booking'
}: MapPickerProps) {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [mapCenter, setMapCenter] = useState({ lat: initialLat, lng: initialLng });
  const [zoomLevel, setZoomLevel] = useState(15);
  const [isConfirming, setIsConfirming] = useState(false);

  // Initialize map center from props or defaults
  useEffect(() => {
    setMapCenter({ lat: initialLat, lng: initialLng });
  }, [initialLat, initialLng]);

  // Detect municipality based on coordinates
  const detectMunicipality = (lat: number, lng: number): string => {
    if (lat >= 16.770 && lat <= 16.790 && lng >= 121.110 && lng <= 121.130) {
      return 'Lagawe';
    } else if (lat >= 16.700 && lat <= 16.760 && lng >= 121.020 && lng <= 121.080) {
      return 'Hingyon';
    } else if (lat >= 16.730 && lat <= 16.810 && lng >= 121.040 && lng <= 121.120) {
      return 'Kiangan';
    }
    return 'Ifugao';
  };

  // Generate address from coordinates
  const generateAddress = (lat: number, lng: number): string => {
    const municipality = detectMunicipality(lat, lng);
    const formattedLat = lat.toFixed(6);
    const formattedLng = lng.toFixed(6);
    return `${municipality}, Ifugao (${formattedLat}, ${formattedLng})`;
  };

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const mapWidth = rect.width;
    const mapHeight = rect.height;
    
    const zoomFactor = Math.pow(2, zoomLevel - 10);
    const latRange = 0.1 / zoomFactor;
    const lngRange = 0.1 / zoomFactor;
    
    const lat = mapCenter.lat + (0.5 - y / mapHeight) * latRange;
    const lng = mapCenter.lng + (x / mapWidth - 0.5) * lngRange;
    
    const municipality = detectMunicipality(lat, lng);
    const address = generateAddress(lat, lng);
    
    setSelectedLocation({
      address,
      lat,
      lng,
      municipality,
      type: 'pinned'
    });
  };

  const handleConfirm = () => {
    if (!selectedLocation) return;
    
    setIsConfirming(true);
    setTimeout(() => {
      onLocationSelect(selectedLocation);
      setIsConfirming(false);
      onClose();
    }, 500);
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 1, 20));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 1, 8));
  };

  const handleReset = () => {
    setMapCenter({ lat: initialLat, lng: initialLng });
    setZoomLevel(15);
    setSelectedLocation(null);
  };

  const handleDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    
    const sensitivity = 0.0001 * Math.pow(2, 20 - zoomLevel);
    setMapCenter(prev => ({
      lat: prev.lat + event.movementY * sensitivity,
      lng: prev.lng - event.movementX * sensitivity
    }));
  };

  const getButtonText = () => {
    switch (context) {
      case 'signup':
        return 'Save Home Location';
      case 'booking':
        return 'Confirm Pickup';
      default:
        return 'Confirm Location';
    }
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 bg-black bg-opacity-50 z-50 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <div className={`fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl transition-transform duration-300 ${isOpen ? 'translate-y-0' : 'translate-y-full'}`} style={{ height: '85vh' }}>
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <i className="ri-close-line text-xl text-gray-600"></i>
          </button>
        </div>

        {/* Map Container */}
        <div className="flex-1 relative bg-gray-100">
          <div 
            className="h-64 bg-gradient-to-br from-green-100 via-green-50 to-yellow-50 relative overflow-hidden cursor-crosshair select-none"
            onClick={handleMapClick}
            onMouseMove={handleDrag}
            style={{
              backgroundImage: `
                radial-gradient(circle at 20% 20%, rgba(34, 197, 94, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 80% 80%, rgba(251, 191, 36, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 40% 60%, rgba(16, 185, 129, 0.05) 0%, transparent 50%)
              `
            }}
          >
            {/* Rice Terrace Pattern */}
            <div className="absolute inset-0" style={{
              backgroundImage: `
                repeating-linear-gradient(
                  45deg,
                  transparent,
                  transparent 10px,
                  rgba(34, 197, 94, 0.05) 10px,
                  rgba(34, 197, 94, 0.05) 20px
                ),
                repeating-linear-gradient(
                  -45deg,
                  transparent,
                  transparent 15px,
                  rgba(251, 191, 36, 0.03) 15px,
                  rgba(251, 191, 36, 0.03) 30px
                )
              `
            }}></div>

            {/* Municipality Markers */}
            <div className="absolute top-4 left-4 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">L</div>
            <div className="absolute bottom-8 left-8 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-bold">H</div>
            <div className="absolute top-8 right-8 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-white text-xs font-bold">K</div>

            {/* Landmark Indicators */}
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-xs">C</div>
            <div className="absolute bottom-12 right-12 w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center text-white text-xs">M</div>
            <div className="absolute top-12 right-16 w-4 h-4 bg-indigo-500 rounded-full flex items-center justify-center text-white text-xs">U</div>

            {/* Center Crosshair */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-gray-600 bg-white bg-opacity-75 rounded-full"></div>
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-gray-600 rounded-full"></div>
            </div>

            {/* Selected Pin */}
            {selectedLocation && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                <div className={`w-8 h-8 ${pinColor === 'green' ? 'bg-green-500' : 'bg-red-500'} rounded-full border-4 border-white shadow-lg flex items-center justify-center animate-bounce`}>
                  <i className="ri-map-pin-fill text-white text-sm"></i>
                </div>
              </div>
            )}

            {/* Zoom Level Indicator */}
            <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
              {zoomLevel}x
            </div>
          </div>

          {/* Map Controls */}
          <div className="absolute right-4 top-4 flex flex-col space-y-2">
            <button
              onClick={handleZoomIn}
              className="w-10 h-10 bg-white shadow-lg rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
            >
              <i className="ri-add-line text-lg"></i>
            </button>
            <button
              onClick={handleZoomOut}
              className="w-10 h-10 bg-white shadow-lg rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
            >
              <i className="ri-subtract-line text-lg"></i>
            </button>
            <button
              onClick={handleReset}
              className="w-10 h-10 bg-white shadow-lg rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
            >
              <i className="ri-refresh-line text-lg"></i>
            </button>
          </div>

          {/* Instructions */}
          <div className="absolute bottom-4 left-4 bg-black bg-opacity-75 text-white p-3 rounded-lg text-xs max-w-48">
            <p className="mb-1">📍 Drag to move around Ifugao</p>
            <p className="mb-1">👆 Tap to pin {isSignupMode ? 'home' : (pinColor === 'green' ? 'pickup' : 'destination')} location</p>
            <p>🔍 Use controls to zoom</p>
          </div>
        </div>

        {/* Location Info & Confirm */}
        <div className="p-4 border-t bg-white">
          {selectedLocation && (
            <div className="p-4 bg-gray-50 border-t border-gray-200">
              <div className="flex items-start space-x-3">
                <div className={`w-6 h-6 ${pinColor === 'green' ? 'bg-green-500' : 'bg-red-500'} rounded-full flex items-center justify-center flex-shrink-0 mt-1`}>
                  <i className="ri-map-pin-fill text-white text-sm"></i>
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900 text-sm">
                    {isSignupMode ? 'Home Address' : (pinColor === 'green' ? 'Pickup' : 'Destination')}: {selectedLocation.municipality}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">{selectedLocation.address}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    📍 {selectedLocation.lat.toFixed(6)}, {selectedLocation.lng.toFixed(6)}
                  </p>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={!selectedLocation || isConfirming}
            className={`w-full py-4 rounded-xl font-semibold transition-colors ${
              selectedLocation && !isConfirming
                ? 'bg-blue-500 text-white hover:bg-blue-600' 
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isConfirming ? 'Saving...' : getButtonText()}
          </button>
        </div>

      </div>
    </div>
  );
}
