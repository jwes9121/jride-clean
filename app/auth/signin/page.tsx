import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

type SignInPageProps = {
  searchParams?: {
    callbackUrl?: string;
  };
};

// SERVER COMPONENT (no "use client")
export default function SignInPage({ searchParams }: SignInPageProps) {
  const rawCallback = searchParams?.callbackUrl;

  // Default to livetrips
  let callbackUrl = "/admin/livetrips";

  if (typeof rawCallback === "string" && rawCallback.length > 0) {
    if (rawCallback.startsWith("/admin/livetrip")) {
      callbackUrl = "/admin/livetrips";
    } else {
      callbackUrl = rawCallback;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8 space-y-6">
        <h1 className="text-2xl font-semibold text-center">Sign in</h1>
        <p className="text-sm text-center text-slate-500">
          Use your Google account to access the JRide admin console.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", {
              redirectTo: callbackUrl,
            });
          }}
        >
          <Button type="submit" size="lg" className="w-full">
            Continue with Google
          </Button>
        </form>
      </div>
    </div>
  );
}
