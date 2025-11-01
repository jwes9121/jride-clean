'use client';

import { useState } from 'react';

interface Landmark {
  id: string;
  name: string;
  description?: string;
  address?: string;
  town?: string;
  latitude: number;
  longitude: number;
  tagged_user?: {
    full_name: string;
    phone: string;
  };
  created_at: string;
  driver_notes?: string;
}

interface LandmarkApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingLandmarks: Landmark[];
  onRefresh: () => void;
}

export default function LandmarkApprovalModal({
  isOpen,
  onClose,
  pendingLandmarks,
  onRefresh
}: LandmarkApprovalModalProps) {
  const [selectedLandmark, setSelectedLandmark] = useState<Landmark | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    address: '',
    town: ''
  });
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const openDetails = (landmark: Landmark) => {
    setSelectedLandmark(landmark);
    setEditForm({
      name: landmark.name,
      description: landmark.description || '',
      address: landmark.address || '',
      town: landmark.town || ''
    });
    setShowDetails(true);
  };

  const handleApprove = async (landmarkId: string, edits?: any) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('dispatcher-token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/landmark-service`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'approve_landmark',
          landmarkId,
          edits
        })
      });
      
      const data = await response.json();
      if (data.success) {
        onRefresh();
        if (showDetails) setShowDetails(false);
      }
    } catch (error) {
      console.error('Error approving landmark:', error);
      alert('Failed to approve landmark');
    }
    setLoading(false);
  };

  const handleReject = async () => {
    if (!selectedLandmark || !rejectionReason.trim()) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('dispatcher-token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/landmark-service`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'reject_landmark',
          landmarkId: selectedLandmark.id,
          reason: rejectionReason
        })
      });
      
      const data = await response.json();
      if (data.success) {
        onRefresh();
        setShowRejectionModal(false);
        setShowDetails(false);
        setRejectionReason('');
      }
    } catch (error) {
      console.error('Error rejecting landmark:', error);
      alert('Failed to reject landmark');
    }
    setLoading(false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-end z-50">
        <div className="bg-white w-full rounded-t-2xl max-h-[90%] flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Landmark Approvals</h3>
              <p className="text-sm text-gray-600">{pendingLandmarks.length} pending review</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center">
              <i className="ri-close-line text-xl"></i>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {pendingLandmarks.length === 0 ? (
              <div className="text-center py-12">
                <i className="ri-check-double-line text-4xl text-green-500 mb-4"></i>
                <h4 className="text-lg font-semibold text-gray-800 mb-2">All Caught Up!</h4>
                <p className="text-gray-600">No landmarks pending approval</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingLandmarks.map((landmark) => (
                  <div key={landmark.id} className="bg-gray-50 rounded-xl p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-800 mb-1">{landmark.name}</h4>
                        {landmark.description && (
                          <p className="text-sm text-gray-600 mb-2">{landmark.description}</p>
                        )}
                        <div className="text-xs text-gray-500 space-y-1">
                          {landmark.address && (
                            <div className="flex items-center space-x-1">
                              <i className="ri-map-pin-line"></i>
                              <span>{landmark.address}</span>
                            </div>
                          )}
                          {landmark.town && (
                            <div className="flex items-center space-x-1">
                              <i className="ri-building-line"></i>
                              <span>{landmark.town}</span>
                            </div>
                          )}
                          <div className="flex items-center space-x-1">
                            <i className="ri-user-line"></i>
                            <span>{landmark.tagged_user?.full_name} â€¢ {formatDate(landmark.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-orange-100 px-2 py-1 rounded-full">
                        <span className="text-xs font-medium text-orange-700">Pending</span>
                      </div>
                    </div>

                    <div className="flex space-x-2">
                      <button
                        onClick={() => openDetails(landmark)}
                        className="flex-1 bg-blue-500 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
                      >
                        Review Details
                      </button>
                      <button
                        onClick={() => handleApprove(landmark.id)}
                        disabled={loading}
                        className="bg-green-500 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-green-600 transition-colors disabled:bg-gray-300"
                      >
                        Quick Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Landmark Details Modal */}
      {showDetails && selectedLandmark && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90%] overflow-y-auto">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold">Review Landmark</h4>
                <button
                  onClick={() => setShowDetails(false)}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
                >
                  <i className="ri-close-line text-xl"></i>
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Submission Info */}
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <i className="ri-information-line text-blue-600"></i>
                  <span className="text-sm font-medium text-blue-800">Submission Details</span>
                </div>
                <div className="text-xs text-blue-700 space-y-1">
                  <p><strong>Submitted by:</strong> {selectedLandmark.tagged_user?.full_name}</p>
                  <p><strong>Phone:</strong> {selectedLandmark.tagged_user?.phone}</p>
                  <p><strong>Date:</strong> {formatDate(selectedLandmark.created_at)}</p>
                  <p><strong>Location:</strong> {selectedLandmark.latitude.toFixed(6)}, {selectedLandmark.longitude.toFixed(6)}</p>
                </div>
              </div>

              {/* Editable Form */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Landmark Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    placeholder="Optional description"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    placeholder="Street address"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Town/Barangay</label>
                  <input
                    type="text"
                    value={editForm.town}
                    onChange={(e) => setEditForm({ ...editForm, town: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    placeholder="e.g., Barangay Tuplac"
                  />
                </div>
              </div>

              {/* Quality Guidelines */}
              <div className="bg-yellow-50 p-3 rounded-lg">
                <div className="flex items-start space-x-2">
                  <i className="ri-lightbulb-line text-yellow-600 mt-0.5"></i>
                  <div>
                    <p className="text-sm font-medium text-yellow-800 mb-1">Quality Guidelines</p>
                    <ul className="text-xs text-yellow-700 space-y-1">
                      <li>â€¢ Names should be clear and specific</li>
                      <li>â€¢ Avoid duplicate or similar landmarks</li>
                      <li>â€¢ Check location accuracy</li>
                      <li>â€¢ Ensure it's a useful reference point</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => {
                    setShowRejectionModal(true);
                  }}
                  className="flex-1 bg-red-500 text-white py-3 rounded-xl font-semibold hover:bg-red-600 transition-colors"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleApprove(selectedLandmark.id, editForm)}
                  disabled={loading || !editForm.name.trim()}
                  className="flex-1 bg-green-500 text-white py-3 rounded-xl font-semibold hover:bg-green-600 transition-colors disabled:bg-gray-300"
                >
                  {loading ? 'Approving...' : 'Approve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {showRejectionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-70 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="p-4 border-b">
              <h4 className="text-lg font-semibold text-red-700">Reject Landmark</h4>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600">
                Please provide a reason for rejection. This helps maintain data quality standards.
              </p>

              <div className="space-y-2">
                {[
                  'Duplicate location',
                  'Inaccurate or unclear name',
                  'Not a useful landmark',
                  'Inappropriate content',
                  'Wrong location coordinates'
                ].map((reason) => (
                  <button
                    key={reason}
                    onClick={() => setRejectionReason(reason)}
                    className={`w-full p-3 text-left text-sm rounded-lg border transition-colors ${
                      rejectionReason === reason
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Custom Reason</label>
                <textarea
                  value={rejectionReason.startsWith('Duplicate') || rejectionReason.startsWith('Inaccurate') || 
                         rejectionReason.startsWith('Not a') || rejectionReason.startsWith('Inappropriate') || 
                         rejectionReason.startsWith('Wrong') ? '' : rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
                  rows={3}
                  placeholder="Enter custom reason..."
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowRejectionModal(false);
                    setRejectionReason('');
                  }}
                  className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-xl font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={loading || !rejectionReason.trim()}
                  className="flex-1 bg-red-500 text-white py-3 rounded-xl font-semibold hover:bg-red-600 transition-colors disabled:bg-gray-300"
                >
                  {loading ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}



