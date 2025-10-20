"use client";

import React, { useState } from "react";
import AuthModal from "@/components/AuthModal";

export default function DriverPayoutsPage() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="flex-1 p-4">
        <h1 className="mb-4 text-xl font-semibold text-gray-800">Driver Payouts</h1>

        <button
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => setShowAuthModal(true)}
        >
          Sign in to continue
        </button>
      </main>

      {showAuthModal && (
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          mode="signin"
        />
      )}
    </div>
  );
}


