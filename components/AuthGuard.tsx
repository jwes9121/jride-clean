"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import AuthModal from "./AuthModal";

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    // In production we're using a stub supabase client,
    // so guard against supabase.auth being undefined.
    if (
      supabase &&
      (supabase as any).auth &&
      (supabase as any).auth.onAuthStateChange
    ) {
      const {
        data: { subscription },
      } = (supabase as any).auth.onAuthStateChange(
        (_event: any, session: any) => {
          if (session) {
            setShowAuthModal(false);
          } else {
            setShowAuthModal(true);
          }
          setIsLoading(false);
        }
      );

      cleanup = () => {
        try {
          subscription?.unsubscribe?.();
        } catch {
          // ignore unsubscribe errors in stub
        }
      };
    } else {
      // Fallback: assume authenticated so UI can render.
      setShowAuthModal(false);
      setIsLoading(false);
    }

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Checking authentication...
      </div>
    );
  }

  if (showAuthModal) {
    return (
      <AuthModal
        isOpen={true}
        onClose={() => {
          // If modal needs to close, just hide it locally.
          setShowAuthModal(false);
        }}
      />
    );
  }

  return <>{children}</>;
}