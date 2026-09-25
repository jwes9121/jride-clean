type RecoveryAccount = { email?: string | null; user_metadata?: Record<string, unknown> | null };

// Use the same PH mobile identity accepted by passenger login. The auth email,
// rather than editable profile metadata, identifies the account to recover.
export function recoveryLoginEmail(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  const mobile = /^09\d{9}$/.test(digits) ? "63" + digits.slice(1)
    : /^9\d{9}$/.test(digits) ? "63" + digits
    : /^639\d{9}$/.test(digits) ? digits : null;
  return mobile ? "p_" + mobile + "@phone.jride.local" : null;
}

export function matchesRecoveryAccount(account: RecoveryAccount, email: string, loginEmail: string | null): boolean {
  const contact = String(account.user_metadata?.contact_email || "").trim().toLowerCase();
  return contact === email.trim().toLowerCase()
    && (!loginEmail || String(account.email || "").toLowerCase() === loginEmail);
}

export function recoveryPhoneSuffix(email: unknown): string | null {
  const match = /^p_639\d{5}(\d{4})@phone\.jride\.local$/i.exec(String(email || ""));
  return match ? match[1] : null;
}
