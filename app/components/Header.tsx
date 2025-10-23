import Link from "next/link";
import UserMenu from "./UserMenu";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 w-full bg-white/80 backdrop-blur border-b">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* J-Ride logo / title */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-black flex items-center justify-center">
            {/* simple JR monogram */}
            <span className="text-white text-xs font-bold">JR</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">J-Ride</span>
        </Link>

        {/* user menu on the right */}
        <UserMenu />
      </div>
    </header>
  );
}
