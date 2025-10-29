"use client";

export default function GoogleSignInButton() {
  function handleClick() {
    // tell the browser to start the OAuth flow
    window.location.href = "/api/auth/signin?provider=google";
  }

  return (
    <button
      onClick={handleClick}
      className="rounded bg-black text-white px-4 py-2"
    >
      Continue with Google
    </button>
  );
}
