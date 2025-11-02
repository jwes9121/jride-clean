'use client';

import { useState } from 'react';

interface FareEntry {
  id: string;
  route_from: string;
  route_to: string;
  driver_proposed_fare: number;
  current_standard_fare?: number;
  vehicle_type: string;
  distance_km?: number;
  driver_notes?: string;
  driver_name: string;
  driver_phone: string;
  created_at: string;
  trip_count?: number;
}

interface FareApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingFares: FareEntry[];
  onRefresh: () => void;
}

export default function FareApprovalModal({
  isOpen,
  onClose,
  pendingFares,
  onRefresh
}: FareApprovalModalProps) {
  const [selectedFare, setSelectedFare] = useState<FareEntry | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [adjustedFare, setAdjustedFare] = useState(0);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const openDetails = (fare: FareEntry) => {
    setSelectedFare(fare);
    setAdjustedFare(fare.driver_proposed_fare);
    setShowDetails(true);
  };

  const handleApproveFare = async (fareId: string, approvedFare?: number) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('dispatcher-token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/enhanced-driver-management`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'approve_fare',
          fareId,
          approvedFare: approvedFare || selectedFare?.driver_proposed_fare
        })
      });
      
      const data = await response.json();
      if (data.success) {
        onRefresh();
        if (showDetails) setShowDetails(false);
      }
    } catch (error) {
      console.error('Error approving fare:', error);
      alert('Failed to approve fare');
    }
    setLoading(false);
  };

  const handleRejectFare = async () => {
    if (!selectedFare || !rejectionReason.trim()) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('dispatcher-token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/enhanced-driver-management`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'reject_fare',
          fareId: selectedFare.id,
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
      console.error('Error rejecting fare:', error);
      alert('Failed to reject fare');
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

  const getFareStatus = (fare: FareEntry) => {
    if (!fare.current_standard_fare) return 'new-route';
    
    const difference = fare.driver_proposed_fare - fare.current_standard_fare;
    const percentDiff = (difference / fare.current_standard_fare) * 100;
    
    if (Math.abs(percentDiff) <= 10) return 'normal';
    if (percentDiff > 10) return 'high';
    return 'low';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new-route': return 'bg-blue-100 text-blue-700';
      case 'normal': return 'bg-green-100 text-green-700';
      case 'high': return 'bg-red-100 text-red-700';
      case 'low': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'new-route': return 'New Route';
      case 'normal': return 'Normal';
      case 'high': return 'Above Standard';
      case 'low': return 'Below Standard';
      default: return 'Unknown';
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-end z-50">
        <div className="bg-white w-full rounded-t-2xl max-h-[90%] flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Fare Approvals</h3>
              <p className="text-sm text-gray-600">{pendingFares.length} pending review</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center">
              <i className="ri-close-line text-xl"></i>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {pendingFares.length === 0 ? (
              <div className="text-center py-12">
                <i className="ri-check-double-line text-4xl text-green-500 mb-4"></i>
                <h4 className="text-lg font-semibold text-gray-800 mb-2">All Caught Up!</h4>
                <p className="text-gray-600">No fares pending approval</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingFares.map((fare) => {
                  const status = getFareStatus(fare);
                  return (
                    <div key={fare.id} className="bg-gray-50 rounded-xl p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <h4 className="font-semibold text-gray-800">
                              {fare.route_from} Ã¢â€ â€™ {fare.route_to}
                            </h4>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
                              {getStatusText(status)}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 mb-2">
                            <div>
                              <span className="text-xs text-gray-500">Proposed Fare</span>
                              <div className="text-lg font-bold text-purple-600">Ã¢â€šÂ±{fare.driver_proposed_fare}</div>
                            </div>
                            {fare.current_standard_fare && (
                              <div>
                                <span className="text-xs text-gray-500">Current Standard</span>
                                <div className="text-lg font-bold text-gray-600">Ã¢â€šÂ±{fare.current_standard_fare}</div>
                              </div>
                            )}
                          </div>

                          <div className="text-xs text-gray-500 space-y-1">
                            <div className="flex items-center space-x-1">
                              <i className="ri-truck-line"></i>
                              <span>{fare.vehicle_type}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <i className="ri-user-line"></i>
                              <span>{fare.driver_name} Ã¢â‚¬Â¢ {formatDate(fare.created_at)}</span>
                            </div>
                            {fare.distance_km && (
                              <div className="flex items-center space-x-1">
                                <i className="ri-route-line"></i>
                                <span>{fare.distance_km} km</span>
                              </div>
                            )}
                          </div>

                          {fare.driver_notes && (
                            <div className="mt-2 p-2 bg-blue-50 rounded-lg">
                              <p className="text-xs text-blue-700">
                                <strong>Driver notes:</strong> {fare.driver_notes}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex space-x-2">
                        <button
                          onClick={() => openDetails(fare)}
                          className="flex-1 bg-blue-500 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
                        >
                          Review Details
                        </button>
                        <button
                          onClick={() => handleApproveFare(fare.id)}
                          disabled={loading}
                          className="bg-green-500 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-green-600 transition-colors disabled:bg-gray-300"
                        >
                          Quick Approve
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fare Details Modal */}
      {showDetails && selectedFare && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90%] overflow-y-auto">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold">Review Fare Entry</h4>
                <button
                  onClick={() => setShowDetails(false)}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
                >
                  <i className="ri-close-line text-xl"></i>
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Route Info */}
              <div className="bg-purple-50 p-3 rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <i className="ri-route-line text-purple-600"></i>
                  <span className="text-sm font-medium text-purple-800">Route Information</span>
                </div>
                <div className="text-sm text-purple-700 space-y-1">
                  <p><strong>From:</strong> {selectedFare.route_from}</p>
                  <p><strong>To:</strong> {selectedFare.route_to}</p>
                  <p><strong>Vehicle:</strong> {selectedFare.vehicle_type}</p>
                  {selectedFare.distance_km && <p><strong>Distance:</strong> {selectedFare.distance_km} km</p>}
                </div>
              </div>

              {/* Driver Info */}
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <i className="ri-user-line text-blue-600"></i>
                  <span className="text-sm font-medium text-blue-800">Driver Information</span>
                </div>
                <div className="text-sm text-blue-700 space-y-1">
                  <p><strong>Name:</strong> {selectedFare.driver_name}</p>
                  <p><strong>Phone:</strong> {selectedFare.driver_phone}</p>
                  <p><strong>Submitted:</strong> {formatDate(selectedFare.created_at)}</p>
                  {selectedFare.trip_count && <p><strong>Total Trips:</strong> {selectedFare.trip_count}</p>}
                </div>
              </div>

              {/* Fare Analysis */}
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <i className="ri-money-dollar-circle-line text-gray-600"></i>
                  <span className="text-sm font-medium text-gray-800">Fare Analysis</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-gray-500">Proposed</span>
                    <div className="text-lg font-bold text-purple-600">Ã¢â€šÂ±{selectedFare.driver_proposed_fare}</div>
                  </div>
                  {selectedFare.current_standard_fare && (
                    <div>
                      <span className="text-xs text-gray-500">Current</span>
                      <div className="text-lg font-bold text-gray-600">Ã¢â€šÂ±{selectedFare.current_standard_fare}</div>
                    </div>
                  )}
                </div>
                
                {selectedFare.current_standard_fare && (
                  <div className="mt-2 text-xs text-gray-600">
                    <span>Difference: </span>
                    <span className={
                      selectedFare.driver_proposed_fare > selectedFare.current_standard_fare 
                        ? 'text-red-600 font-medium' 
                        : selectedFare.driver_proposed_fare < selectedFare.current_standard_fare
                        ? 'text-green-600 font-medium'
                        : 'text-gray-600'
                    }>
                      {selectedFare.driver_proposed_fare > selectedFare.current_standard_fare ? '+' : ''}
                      Ã¢â€šÂ±{selectedFare.driver_proposed_fare - selectedFare.current_standard_fare}
                    </span>
                  </div>
                )}
              </div>

              {/* Driver Notes */}
              {selectedFare.driver_notes && (
                <div className="bg-yellow-50 p-3 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <i className="ri-sticky-note-line text-yellow-600 mt-0.5"></i>
                    <div>
                      <p className="text-sm font-medium text-yellow-800 mb-1">Driver Notes</p>
                      <p className="text-sm text-yellow-700">{selectedFare.driver_notes}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Fare Adjustment */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Approved Fare Amount</label>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-500">Ã¢â€šÂ±</span>
                  <input
                    type="number"
                    value={adjustedFare}
                    onChange={(e) => setAdjustedFare(Number(e.target.value))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    min="0"
                    step="5"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Adjust if needed. Leave as proposed amount to approve as-is.
                </p>
              </div>

              {/* Pricing Guidelines */}
              <div className="bg-green-50 p-3 rounded-lg">
                <div className="flex items-start space-x-2">
                  <i className="ri-lightbulb-line text-green-600 mt-0.5"></i>
                  <div>
                    <p className="text-sm font-medium text-green-800 mb-1">Pricing Guidelines</p>
                    <ul className="text-xs text-green-700 space-y-1">
                      <li>Ã¢â‚¬Â¢ Base fare: Ã¢â€šÂ±30 for local trips</li>
                      <li>Ã¢â‚¬Â¢ Long distance: Ã¢â€šÂ±5-10 per km</li>
                      <li>Ã¢â‚¬Â¢ Difficult terrain: +Ã¢â€šÂ±10-20</li>
                      <li>Ã¢â‚¬Â¢ Peak hours: +Ã¢â€šÂ±5-15</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => setShowRejectionModal(true)}
                  className="flex-1 bg-red-500 text-white py-3 rounded-xl font-semibold hover:bg-red-600 transition-colors"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleApproveFare(selectedFare.id, adjustedFare)}
                  disabled={loading || adjustedFare <= 0}
                  className="flex-1 bg-green-500 text-white py-3 rounded-xl font-semibold hover:bg-green-600 transition-colors disabled:bg-gray-300"
                >
                  {loading ? 'Approving...' : `Approve Ã¢â€šÂ±${adjustedFare}`}
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
              <h4 className="text-lg font-semibold text-red-700">Reject Fare Entry</h4>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600">
                Select a reason for rejecting this fare entry:
              </p>

              <div className="space-y-2">
                {[
                  'Fare too high for route',
                  'Fare too low (below standard)',
                  'Route information unclear',
                  'Insufficient justification',
                  'Duplicate route entry'
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
                  value={rejectionReason.startsWith('Fare too') || rejectionReason.startsWith('Route') || 
                         rejectionReason.startsWith('Insufficient') || rejectionReason.startsWith('Duplicate') ? '' : rejectionReason}
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
                  onClick={handleRejectFare}
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



