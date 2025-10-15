"use client";
import { useSearchParams } from "next/navigation";

const MESSAGES: Record<string,string> = {
  OAuthSignin: "Problem constructing the provider URL.",
  OAuthCallback: "Provider callback failed. Check redirect URI and client credentials.",
  OAuthCreateAccount: "Could not create OAuth account.",
  EmailCreateAccount: "Could not create email account.",
  Callback: "Callback handler error.",
  OAuthAccountNotLinked: "Email is linked to a different sign-in method.",
  EmailSignin: "Email sign-in failed.",
  CredentialsSignin: "Invalid credentials.",
  SessionRequired: "You must be signed in to access this page.",
  Default: "Authentication error.",
};

export default function AuthErrorPage() {
  const code = useSearchParams().get("error") ?? "Default";
  const msg = MESSAGES[code] ?? MESSAGES.Default;
  return (
    <div style={{display:"grid",placeItems:"center",minHeight:"60vh",textAlign:"center",padding:"2rem"}}>
      <h1 style={{fontSize:24,marginBottom:12}}>Sign-in error</h1>
      <p style={{opacity:.85,marginBottom:20}}>{msg}</p>
      <a href="/auth/signin" style={{padding:"0.6rem 1rem",border:"1px solid #e5e7eb",borderRadius:10}}>
        Back to sign in
      </a>
    </div>
  );
}
