
'use client';

import { useState } from 'react';

interface AddressTaggingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (address: string, label: string, forFamily?: boolean) => void;
  currentAddress: string;
  isLowSignal?: boolean;
}

export default function AddressTaggingModal({ 
  isOpen, 
  onClose, 
  onSave, 
  currentAddress,
  isLowSignal = false 
}: AddressTaggingModalProps) {
  const [addressLabel, setAddressLabel] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [useCustomLabel, setUseCustomLabel] = useState(false);
  const [shareWithFamily, setShareWithFamily] = useState(false);
  const [isDispatcherMode, setIsDispatcherMode] = useState(false);

  if (!isOpen) return null;

  const predefinedLabels = [
    { label: 'Home', icon: 'ri-home-line' },
    { label: 'Work', icon: 'ri-building-line' },
    { label: 'School', icon: 'ri-school-line' },
    { label: 'Mall', icon: 'ri-store-line' },
    { label: 'Hospital', icon: 'ri-hospital-line' },
    { label: 'Restaurant', icon: 'ri-restaurant-line' },
    { label: 'Friend\'s Place', icon: 'ri-user-heart-line' },
    { label: 'Relative\'s House', icon: 'ri-group-line' }
  ];

  const handleSave = () => {
    const finalLabel = useCustomLabel ? customLabel : addressLabel;
    if (!finalLabel) return;

    onSave(currentAddress, finalLabel, shareWithFamily);
    handleClose();
  };

  const handleClose = () => {
    setAddressLabel('');
    setCustomLabel('');
    setUseCustomLabel(false);
    setShareWithFamily(false);
    setIsDispatcherMode(false);
    onClose();
  };

  const handleDispatcherTag = async () => {
    // Simulate dispatcher tagging for low signal areas
    const dispatcherTaggedAddress = `${currentAddress} (Dispatcher Tagged)`;
    onSave(dispatcherTaggedAddress, addressLabel || 'Tagged Location', shareWithFamily);
    handleClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50">
      <div className="bg-white w-full rounded-t-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">Save This Address</h3>
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center">
            <i className="ri-close-line text-xl"></i>
          </button>
        </div>

        {/* Low Signal Warning */}
        {isLowSignal && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
            <div className="flex items-center space-x-3 mb-2">
              <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                <i className="ri-signal-wifi-1-line text-yellow-600"></i>
              </div>
              <div>
                <h4 className="font-semibold text-yellow-800">Low Signal Area Detected</h4>
                <p className="text-sm text-yellow-700">Consider saving this address for future bookings</p>
              </div>
            </div>
            
            <div className="bg-white/70 p-3 rounded-lg">
              <p className="text-sm text-yellow-800">
                This location has weak signal. Saving it will help you and your family book rides here more easily in the future.
              </p>
            </div>
          </div>
        )}

        {/* Current Address Display */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="flex items-start space-x-3">
            <i className="ri-map-pin-line text-orange-500 mt-1"></i>
            <div>
              <h4 className="font-medium text-gray-800 mb-1">Current Location</h4>
              <p className="text-sm text-gray-600">{currentAddress}</p>
            </div>
          </div>
        </div>

        {/* Address Label Selection */}
        <div className="mb-6">
          <h4 className="font-semibold mb-4">What should we call this place?</h4>
          
          {!useCustomLabel ? (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {predefinedLabels.map((item) => (
                <button
                  key={item.label}
                  onClick={() => setAddressLabel(item.label)}
                  className={`p-3 rounded-xl border-2 transition-colors ${
                    addressLabel === item.label
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <i className={`${item.icon} text-orange-600`}></i>
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="mb-4">
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Enter custom label..."
                className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
          )}

          <button
            onClick={() => {
              setUseCustomLabel(!useCustomLabel);
              setAddressLabel('');
              setCustomLabel('');
            }}
            className="text-orange-500 text-sm font-medium hover:text-orange-600"
          >
            {useCustomLabel ? 'Choose from presets' : 'Use custom label'}
          </button>
        </div>

        {/* Family Sharing Option */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <i className="ri-group-line text-blue-600"></i>
              </div>
              <div>
                <h4 className="font-semibold text-blue-800">Share with Family</h4>
                <p className="text-sm text-blue-700">Let family members use this address for bookings</p>
              </div>
            </div>
            <button
              onClick={() => setShareWithFamily(!shareWithFamily)}
              className={`w-12 h-6 rounded-full transition-colors ${
                shareWithFamily ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  shareWithFamily ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              ></div>
            </button>
          </div>
        </div>

        {/* Dispatcher Fallback for Low Signal */}
        {isLowSignal && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <i className="ri-headphone-line text-orange-600"></i>
              </div>
              <div>
                <h4 className="font-semibold text-orange-800">Dispatcher Assistance</h4>
                <p className="text-sm text-orange-700">Can't get exact location? Let dispatcher help tag this address</p>
              </div>
            </div>
            
            <button
              onClick={() => setIsDispatcherMode(!isDispatcherMode)}
              className={`w-full p-3 rounded-lg border-2 transition-colors ${
                isDispatcherMode
                  ? 'border-orange-500 bg-white'
                  : 'border-orange-200 hover:border-orange-300'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                <i className="ri-phone-line text-orange-600"></i>
                <span className="font-medium text-orange-800">
                  {isDispatcherMode ? 'Dispatcher mode enabled' : 'Request dispatcher tagging'}
                </span>
              </div>
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          {isDispatcherMode && isLowSignal ? (
            <button
              onClick={handleDispatcherTag}
              disabled={!addressLabel && !customLabel}
              className="w-full bg-orange-500 text-white py-4 rounded-xl font-semibold hover:bg-orange-600 transition-colors disabled:bg-gray-300"
            >
              Request Dispatcher Tagging
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={(!addressLabel && !customLabel)}
              className="w-full bg-orange-500 text-white py-4 rounded-xl font-semibold hover:bg-orange-600 transition-colors disabled:bg-gray-300"
            >
              Save Address
              {shareWithFamily && (
                <span className="ml-2 bg-white/20 px-2 py-1 rounded-full text-xs">
                  + Share with Family
                </span>
              )}
            </button>
          )}
          
          <button
            onClick={handleClose}
            className="w-full bg-gray-200 text-gray-800 py-3 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
          >
            Maybe Later
          </button>
        </div>

        {/* Benefits Reminder */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4">
          <h4 className="font-semibold text-green-800 mb-2">Why save addresses?</h4>
          <ul className="text-sm text-green-700 space-y-1">
            <li>✅ Faster bookings in low signal areas</li>
            <li>✅ Help family members find this location</li>
            <li>✅ Reduce GPS errors during pickup</li>
            <li>✅ Works even when connection is poor</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
