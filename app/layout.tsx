import type { Metadata } from "next";
import Providers from "./providers";
import Image from "next/image";
import Link from "next/link";
import UserMenu from "./components/UserMenu";
import "./globals.css"; // keep if you have it; otherwise remove this line

export const metadata: Metadata = {
  title: "J-Ride",
  description: "Ifugao ride-hailing and delivery",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Providers>
          <header className="sticky top-0 z-20 bg-white border-b">
            <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2">
                <Image
                  src="/jride-logo.svg"
                  alt="J-Ride"
                  width={28}
                  height={28}
                />
                <span className="font-semibold">J-Ride</span>
              </Link>
              {/* User avatar / menu on the right */}
              <UserMenu />
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
