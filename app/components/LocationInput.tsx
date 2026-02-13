'use client';

import { useState, useEffect, useRef } from 'react';

interface Location {
  address: string;
  lat: number;
  lng: number;
  municipality?: string;
  barangay?: string;
  type?: string;
}

interface LocationInputProps {
  placeholder: string;
  value: string;
  onLocationSelect: (location: Location) => void;
  showMapButton?: boolean;
  onMapButtonClick?: () => void;
  label?: string;       // âœ… added
  icon?: string;        // âœ… added
  iconColor?: string;   // âœ… added
}

// ðŸ”¹ Your static location data
const IFUGAO_LOCATIONS = [
  { name: 'Poblacion East, Lagawe', municipality: 'Lagawe', barangay: 'Poblacion East', type: 'barangay', lat: 16.7800, lng: 121.1200 },
  { name: 'Poblacion North, Lagawe', municipality: 'Lagawe', barangay: 'Poblacion North', type: 'barangay', lat: 16.7820, lng: 121.1180 },
  // ... keep the rest of your locations here
];

export default function LocationInput({
  placeholder,
  value,
  onLocationSelect,
  showMapButton = false,
  onMapButtonClick,
  label,
  icon = 'ri-map-pin-line',
  iconColor = 'gray',
}: LocationInputProps) {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<typeof IFUGAO_LOCATIONS>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
        setSelectedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setInputValue(query);
    setSelectedIndex(-1);

    if (query.length > 0) {
      const filtered = IFUGAO_LOCATIONS.filter(location =>
        location.name.toLowerCase().includes(query.toLowerCase()) ||
        location.municipality?.toLowerCase().includes(query.toLowerCase()) ||
        location.barangay?.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8);

      setSuggestions(filtered);
      setShowDropdown(true);
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
  };

  const handleSuggestionClick = (location: typeof IFUGAO_LOCATIONS[0]) => {
    const selectedLocation: Location = {
      address: location.name,
      lat: location.lat,
      lng: location.lng,
      municipality: location.municipality,
      barangay: location.barangay,
      type: location.type,
    };
    setInputValue(location.name);
    setShowDropdown(false);
    setSuggestions([]);
    setSelectedIndex(-1);
    onLocationSelect(selectedLocation);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          handleSuggestionClick(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  return (
    <div className="relative">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <div className="flex space-x-2">
        <div className="flex-1 relative">
          {/* icon support */}
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <i className={`${icon} text-${iconColor}-500`} />
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) {
                setShowDropdown(true);
              }
            }}
            placeholder={placeholder}
            className={`w-full ${icon ? 'pl-10' : 'pl-4'} pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm`}
          />

          {/* Dropdown */}
          {showDropdown && suggestions.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-64 overflow-y-auto mt-1"
            >
              {suggestions.map((location, index) => (
                <button
                  key={`${location.name}-${index}`}
                  onClick={() => handleSuggestionClick(location)}
                  className={`w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors ${
                    index === selectedIndex ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <i className="ri-map-pin-line text-gray-400 flex-shrink-0"></i>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{location.name}</p>
                      <p className="text-xs text-gray-500 capitalize">
                        {location.type} â€¢ {location.municipality}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {showMapButton && (
          <button
            onClick={() => {
              setShowDropdown(false);
              onMapButtonClick?.();
            }}
            className="px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center flex-shrink-0"
          >
            <i className="ri-map-pin-line text-lg"></i>
          </button>
        )}
      </div>
    </div>
  );
}



