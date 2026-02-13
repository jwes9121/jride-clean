'use client';

import React, { useState } from 'react';

interface DeliveryOrder {
  id: string;
  vendor_name: string;
  vendor_address: string;
  customer_name: string;
  customer_address: string;
  customer_phone: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  total_amount: number;
  status: string;
  driver_id?: string;
  pickup_code?: string;
  created_at: string;
  estimated_pickup_time?: string;
  estimated_delivery_time?: string;
}

interface DeliveryStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: DeliveryOrder; // Ã¢Å“â€¦ non-null
  onConfirm: (orderId: string, rating?: number, feedback?: string) => void;
}

const DeliveryStatusModal: React.FC<DeliveryStatusModalProps> = ({
  isOpen,
  onClose,
  order,
  onConfirm,
}) => {
  const [rating, setRating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-lg font-bold mb-4">Confirm Delivery</h2>
        <p className="mb-4">
          Did you receive your order{" "}
          <span className="font-semibold">#{order.id}</span>?
        </p>

        {/* Rating */}
        <div className="flex space-x-2 mb-4">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => setRating(star)}
              className={`text-2xl ${
                rating && rating >= star ? 'text-yellow-400' : 'text-gray-300'
              }`}
            >
              Ã¢Ëœâ€¦
            </button>
          ))}
        </div>

        {/* Feedback */}
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Leave feedback (optional)"
          className="w-full p-2 border rounded-lg mb-4"
          rows={3}
        />

        <div className="flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(order.id, rating || undefined, feedback)}
            className="px-4 py-2 bg-green-500 text-white rounded-md"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeliveryStatusModal;



