"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearFarmerPin, restoreFarmerSession, signInFarmer, signOutFarmer } from "@/lib/agrimarket/farmerSessionClient";

export function useFarmerSession() {
  const [accessCode, setAccessCode] = useState("");
  const [pin, setPin] = useState("");
  const [sessionCode, setSessionCode] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [authError, setAuthError] = useState("");
  const flight = useRef(false);
  useEffect(() => {
    let current = true;
    void restoreFarmerSession().then(code => {
      if (current) { setAccessCode(code); setSessionCode(code); }
    }).catch(error => { if (current) setAuthError(error.message); })
      .finally(() => { if (current) setRestoring(false); });
    return () => { current = false; };
  }, []);
  const invalidate = useCallback(() => { clearFarmerPin(); setPin(""); setSessionCode(""); }, []);
  async function signIn() {
    if (flight.current || restoring) return;
    flight.current = true; setRestoring(true); setAuthError("");
    try { const code = await signInFarmer(accessCode, pin); setAccessCode(code); setPin(""); setSessionCode(code); }
    catch (error: any) { setAuthError(error.message || "Farmer sign-in failed. Try again."); }
    finally { flight.current = false; setRestoring(false); }
  }
  async function signOut() {
    if (flight.current) return;
    flight.current = true; setRestoring(true); setAuthError("");
    try { await signOutFarmer(sessionCode); invalidate(); setAccessCode(""); }
    catch { setAuthError("Could not sign out. Check your connection and try again."); }
    finally { flight.current = false; setRestoring(false); }
  }
  return { accessCode, setAccessCode, pin, setPin, sessionCode, restoring, authError, signIn, signOut, invalidate };
}
