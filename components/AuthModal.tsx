"use client";

import React from "react";

export type AuthMode = "signin" | "signup";

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: AuthMode;
  onAuthSuccess?: (userData?: any) => void; // Ã¢â€ Â optional
}

export default function AuthModal({
  isOpen,
  onClose,
  mode = "signin",
  onAuthSuccess,
}: AuthModalProps) {
  if (!isOpen) return null;

  const handleSuccess = () => {
    onAuthSuccess?.(); // call if provided
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 grid place-items-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h2>

        {/* Replace with your real auth UI; call handleSuccess on success */}
        <button className="mt-2 w-full rounded-md border px-3 py-2" onClick={handleSuccess}>
          Continue
        </button>

        <button className="mt-2 w-full text-sm text-gray-500" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}



