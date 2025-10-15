
'use client';

import { useState, useEffect } from 'react';

interface DriverFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (filters: DriverFilters) => void;
}

interface DriverFilters {
  acceptUnverifiedUsers: boolean;
  nightTimeOnly: boolean;
  verifiedUsersOnly: boolean;
}

export default function DriverFilterModal({ isOpen, onClose, onSave }: DriverFilterModalProps) {
  const [filters, setFilters] = useState<DriverFilters>({
    acceptUnverifiedUsers: true,
    nightTimeOnly: false,
    verifiedUsersOnly: false
  });

  useEffect(() => {
    // Load saved filters from localStorage
    const savedFilters = localStorage.getItem('driver-filters');
    if (savedFilters) {
      setFilters(JSON.parse(savedFilters));
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('driver-filters', JSON.stringify(filters));
    onSave(filters);
    onClose();
  };

  const isNightTime = () => {
    const hour = new Date().getHours();
    return hour >= 20 || hour <= 5; // 8 PM to 5 AM
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50">
      <div className="bg-white w-full rounded-t-2xl p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">Passenger Filter Settings</h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-all duration-200"
          >
            <i className="ri-close-line text-xl"></i>
          </button>
        </div>

        <div className="space-y-6">
          {/* Night Time Filter */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <i className="ri-moon-line text-blue-600"></i>
                </div>
                <div>
                  <h4 className="font-semibold text-blue-900">Night Safety Filter</h4>
                  <p className="text-sm text-blue-700">Enhanced safety during 8 PM - 5 AM</p>
                </div>
              </div>
              <div className="relative">
                <input
                  type="checkbox"
                  id="verifiedUsersOnly"
                  checked={filters.verifiedUsersOnly}
                  onChange={(e) => setFilters({ ...filters, verifiedUsersOnly: e.target.checked })}
                  className="sr-only"
                />
                <label
                  htmlFor="verifiedUsersOnly"
                  className={`block w-12 h-6 rounded-full cursor-pointer transition-colors ${
                    filters.verifiedUsersOnly ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                      filters.verifiedUsersOnly ? 'translate-x-6' : 'translate-x-0.5'
                    } mt-0.5`}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-white/70 p-3 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-blue-800">Accept Only Verified Users at Night</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      id="nightTimeOnly"
                      checked={filters.nightTimeOnly}
                      onChange={(e) => setFilters({ ...filters, nightTimeOnly: e.target.checked })}
                      className="sr-only"
                    />
                    <label
                      htmlFor="nightTimeOnly"
                      className={`block w-10 h-5 rounded-full cursor-pointer transition-colors ${
                        filters.nightTimeOnly ? 'bg-blue-500' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${
                          filters.nightTimeOnly ? 'translate-x-5' : 'translate-x-0.5'
                        } mt-0.5`}
                      />
                    </label>
                  </div>
                </div>
                <p className="text-xs text-blue-600 mt-1">
                  {isNightTime() ? '🌙 Night time active - Enhanced safety mode' : '☀️ Day time - Standard mode'}
                </p>
              </div>

              {filters.verifiedUsersOnly && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <h5 className="font-semibold text-green-800 text-sm mb-1">Safety Benefits:</h5>
                  <ul className="text-xs text-green-700 space-y-1">
                    <li>✅ Only accept passengers with Google/Facebook verification</li>
                    <li>✅ Reduced risk of problematic passengers</li>
                    <li>✅ Higher passenger accountability</li>
                    <li>✅ Enhanced trip safety during night hours</li>
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* General Filter */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <i className="ri-shield-line text-gray-600"></i>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">General Passenger Settings</h4>
                  <p className="text-sm text-gray-600">All-day passenger preferences</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-white p-3 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-800">Accept Unverified Users</span>
                    <p className="text-xs text-gray-600">Phone-only signup passengers</p>
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      id="acceptUnverifiedUsers"
                      checked={filters.acceptUnverifiedUsers}
                      onChange={(e) => setFilters({ ...filters, acceptUnverifiedUsers: e.target.checked })}
                      className="sr-only"
                    />
                    <label
                      htmlFor="acceptUnverifiedUsers"
                      className={`block w-10 h-5 rounded-full cursor-pointer transition-colors ${
                        filters.acceptUnverifiedUsers ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${
                          filters.acceptUnverifiedUsers ? 'translate-x-5' : 'translate-x-0.5'
                        } mt-0.5`}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {!filters.acceptUnverifiedUsers && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="flex items-center space-x-2 mb-1">
                    <i className="ri-alert-line text-yellow-600"></i>
                    <span className="text-sm font-semibold text-yellow-800">Warning</span>
                  </div>
                  <p className="text-xs text-yellow-700">
                    You will only receive requests from verified passengers. This may reduce your trip volume.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Filter Summary */}
          <div className="bg-blue-50 rounded-xl p-4">
            <h4 className="font-semibold text-blue-900 mb-3">Current Filter Summary:</h4>
            <div className="space-y-2">
              {filters.verifiedUsersOnly && (
                <div className="flex items-center space-x-2">
                  <i className="ri-moon-line text-blue-600"></i>
                  <span className="text-sm text-blue-800">Night Safety Mode: Verified users only at night</span>
                </div>
              )}
              {filters.acceptUnverifiedUsers ? (
                <div className="flex items-center space-x-2">
                  <i className="ri-check-line text-green-600"></i>
                  <span className="text-sm text-green-800">Accepting all passenger types during day</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <i className="ri-shield-check-line text-blue-600"></i>
                  <span className="text-sm text-blue-800">Verified passengers only (all day)</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex space-x-3 mt-8">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-500 text-white py-3 rounded-xl font-semibold hover:bg-blue-600 transition-colors"
          >
            Save Filters
          </button>
        </div>
      </div>
    </div>
  );
}
