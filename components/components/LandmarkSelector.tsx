
'use client';

import { useState, useEffect } from 'react';

interface Landmark {
  id: string;
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  address: string;
  usage_count: number;
  town?: string;
}

interface LandmarkSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (landmark: Landmark) => void;
  currentLat?: number;
  currentLng?: number;
  title?: string;
}

export default function LandmarkSelector({ 
  isOpen, 
  onClose, 
  onSelect, 
  currentLat, 
  currentLng,
  title = "Select Landmark" 
}: LandmarkSelectorProps) {
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTagForm, setShowTagForm] = useState(false);
  const [tagForm, setTagForm] = useState({
    name: '',
    description: '',
    address: '',
    town: ''
  });

  useEffect(() => {
    if (isOpen) {
      searchLandmarks();
    }
  }, [isOpen, searchQuery, currentLat, currentLng]);

  const searchLandmarks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'search',
        query: searchQuery,
        ...(currentLat && currentLng && {
          lat: currentLat.toString(),
          lng: currentLng.toString(),
          radius: '10'
        })
      });

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/landmark-service?${params}`
      );
      
      const data = await response.json();
      if (data.success) {
        setLandmarks(data.landmarks);
      }
    } catch (error) {
      console.error('Error searching landmarks:', error);
    }
    setLoading(false);
  };

  const tagNewLandmark = async () => {
    if (!tagForm.name) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('j-ride-token');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/landmark-service`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            action: 'tag',
            name: tagForm.name,
            description: tagForm.description,
            latitude: currentLat || 16.789,
            longitude: currentLng || 121.123,
            address: tagForm.address,
            town: tagForm.town
          })
        }
      );
      
      const data = await response.json();
      if (data.success) {
        setShowTagForm(false);
        setTagForm({ name: '', description: '', address: '', town: '' });
        searchLandmarks();
        
        // Show success message
        alert('Landmark added successfully! It will help other passengers find this location.');
      }
    } catch (error) {
      console.error('Error tagging landmark:', error);
      alert('Failed to add landmark. Please try again.');
    }
    setLoading(false);
  };

  const handleLandmarkSelect = async (landmark: Landmark) => {
    try {
      const token = localStorage.getItem('j-ride-token');
      await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/landmark-service`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            action: 'select',
            landmarkId: landmark.id
          })
        }
      );
    } catch (error) {
      console.error('Error updating landmark usage:', error);
    }
    
    onSelect(landmark);
    onClose();
  };

  const getPopularLandmarks = () => {
    return landmarks.filter(l => l.usage_count >= 5).slice(0, 3);
  };

  const getRecentLandmarks = () => {
    return landmarks.filter(l => l.usage_count < 5);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50">
      <div className="bg-white w-full rounded-t-2xl max-h-[80%] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center">
            <i className="ri-close-line text-xl"></i>
          </button>
        </div>

        <div className="p-4 border-b">
          <div className="relative mb-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              placeholder="Search landmarks..."
            />
            <i className="ri-search-line absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
          </div>
          
          <button
            onClick={() => setShowTagForm(true)}
            className="w-full bg-orange-500 text-white py-2 rounded-xl font-medium text-sm flex items-center justify-center space-x-2"
          >
            <i className="ri-add-line"></i>
            <span>Tag This Location as Landmark</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full mx-auto"></div>
            </div>
          ) : landmarks.length > 0 ? (
            <div className="space-y-4">
              {/* Popular Landmarks */}
              {getPopularLandmarks().length > 0 && (
                <div>
                  <div className="flex items-center space-x-2 mb-3">
                    <i className="ri-fire-line text-orange-500"></i>
                    <h4 className="font-semibold text-gray-800">Popular Landmarks</h4>
                  </div>
                  <div className="space-y-2">
                    {getPopularLandmarks().map((landmark) => (
                      <button
                        key={landmark.id}
                        onClick={() => handleLandmarkSelect(landmark)}
                        className="w-full p-4 bg-orange-50 border border-orange-200 rounded-xl text-left hover:bg-orange-100 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <h4 className="font-semibold text-gray-800">{landmark.name}</h4>
                              <div className="bg-orange-500 text-white px-2 py-0.5 rounded-full text-xs">
                                Popular
                              </div>
                            </div>
                            {landmark.description && (
                              <p className="text-sm text-gray-600 mt-1">{landmark.description}</p>
                            )}
                            <p className="text-xs text-gray-500 mt-1">
                              {landmark.address}
                              {landmark.town && ` â€¢ ${landmark.town}`}
                            </p>
                          </div>
                          <div className="ml-3 text-right">
                            <div className="flex items-center space-x-1 text-xs text-orange-600">
                              <i className="ri-user-line"></i>
                              <span>{landmark.usage_count}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Other Landmarks */}
              {getRecentLandmarks().length > 0 && (
                <div>
                  {getPopularLandmarks().length > 0 && (
                    <div className="flex items-center space-x-2 mb-3">
                      <i className="ri-map-pin-line text-gray-500"></i>
                      <h4 className="font-semibold text-gray-800">Other Landmarks</h4>
                    </div>
                  )}
                  <div className="space-y-2">
                    {getRecentLandmarks().map((landmark) => (
                      <button
                        key={landmark.id}
                        onClick={() => handleLandmarkSelect(landmark)}
                        className="w-full p-4 bg-gray-50 rounded-xl text-left hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-800">{landmark.name}</h4>
                            {landmark.description && (
                              <p className="text-sm text-gray-600 mt-1">{landmark.description}</p>
                            )}
                            <p className="text-xs text-gray-500 mt-1">
                              {landmark.address}
                              {landmark.town && ` â€¢ ${landmark.town}`}
                            </p>
                          </div>
                          <div className="ml-3 text-right">
                            <div className="flex items-center space-x-1 text-xs text-gray-500">
                              <i className="ri-user-line"></i>
                              <span>{landmark.usage_count}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <i className="ri-map-pin-line text-4xl text-gray-300 mb-2"></i>
              <p className="text-gray-500 mb-2">
                {searchQuery ? 'No landmarks found' : 'No landmarks available'}
              </p>
              <p className="text-xs text-gray-400">
                Be the first to add a landmark for this area!
              </p>
            </div>
          )}
        </div>

        {showTagForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
            <div className="bg-white m-4 rounded-2xl p-6 w-full max-w-sm">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-semibold">Tag New Landmark</h4>
                <button
                  onClick={() => setShowTagForm(false)}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
                >
                  <i className="ri-close-line text-xl"></i>
                </button>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <div className="flex items-start space-x-2">
                  <i className="ri-information-line text-blue-600 mt-0.5"></i>
                  <div className="text-xs text-blue-700">
                    <p className="font-medium mb-1">Help other passengers find this location!</p>
                    <p>Add clear, descriptive names like "Joyce Sari-Sari Store" or "Blue Gate House"</p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Landmark Name *</label>
                  <input
                    type="text"
                    value={tagForm.name}
                    onChange={(e) => setTagForm({ ...tagForm, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="e.g. Joyce Sari-Sari Store"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <input
                    type="text"
                    value={tagForm.description}
                    onChange={(e) => setTagForm({ ...tagForm, description: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="Additional info (optional)"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Street Address</label>
                  <input
                    type="text"
                    value={tagForm.address}
                    onChange={(e) => setTagForm({ ...tagForm, address: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="Street or area name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Town/Barangay</label>
                  <input
                    type="text"
                    value={tagForm.town}
                    onChange={(e) => setTagForm({ ...tagForm, town: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="e.g. Barangay Tuplac"
                  />
                </div>
              </div>
              
              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setShowTagForm(false)}
                  className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-xl font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={tagNewLandmark}
                  disabled={loading || !tagForm.name}
                  className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-semibold disabled:bg-gray-300 flex items-center justify-center space-x-2"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                      <span>Adding...</span>
                    </>
                  ) : (
                    <>
                      <i className="ri-save-line"></i>
                      <span>Save Landmark</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


