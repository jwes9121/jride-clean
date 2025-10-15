'use client';

import { useState } from "react";
import Header from "@/components/Header";

export default function VerificationPage() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <div className="p-6">
      <Header title="User Verification" />

      <h2 className="text-2xl font-bold mb-4">User Verification</h2>

      <button
        onClick={() => setShowAuthModal(true)}
        className="bg-blue-500 text-white px-4 py-2 rounded"
      >
        Verify User
      </button>

      {showAuthModal && (
        <div className="mt-4 p-4 border rounded bg-gray-50">
          <p>Verification modal would appear here.</p>
          <button
            onClick={() => setShowAuthModal(false)}
            className="mt-2 bg-gray-300 px-3 py-1 rounded"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

