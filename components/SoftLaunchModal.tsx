"use client";

interface SoftLaunchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SoftLaunchModal({ isOpen, onClose }: SoftLaunchModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full">
        <h3 className="text-lg font-bold mb-4">Soft Launch Notice</h3>
        <p className="text-sm text-gray-600 mb-6">
          {"You're one of the first testers of J-Ride! We appreciate your feedback."}
        </p>
        <button
          onClick={onClose}
          className="w-full bg-orange-500 text-white py-3 rounded-xl font-semibold hover:bg-orange-600"
        >
          Got it
        </button>
      </div>
    </div>
  );
}


