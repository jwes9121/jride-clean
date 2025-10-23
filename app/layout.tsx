// app/layout.tsx
import type { Metadata } from "next";
import Header from "./components/Header";

export const metadata: Metadata = {
  title: "J-Ride",
  description: "Ifugao super-app",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Global header on every page */}
        <Header />
        {children}
      </body>
    </html>
  );
}
