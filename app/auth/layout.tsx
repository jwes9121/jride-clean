import type { ReactNode } from "react";

export const metadata = {
  title: "JRide • Sign in",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      {children}
    </div>
  );
}

