'use client';

import React from 'react';

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

interface VendorConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: DeliveryOrder; // Ã¢Å“â€¦ non-null
  onConfirm: (orderId: string, confirmed: boolean) => void;
}

const VendorConfirmationModal: React.FC<VendorConfirmationModalProps> = ({
  isOpen,
  onClose,
  order,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-lg font-bold mb-4">Confirm Pickup</h2>
        <p className="mb-4">
          Are you sure you want to confirm driver arrival for order{" "}
          <span className="font-semibold">#{order.id}</span>?
        </p>
        <div className="flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(order.id, true)}
            className="px-4 py-2 bg-green-500 text-white rounded-md"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default VendorConfirmationModal;



