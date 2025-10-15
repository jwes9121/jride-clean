"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Home, Package, ShoppingBag, MapPin, User } from "lucide-react";

/** You may import this type elsewhere if you want, but it's optional */
export type TabItem = { key: string; label: string };

/** Allow callers to pass strings OR objects — and make `tabs` OPTIONAL */
type TabsProp = Array<string | TabItem>;

interface BottomNavigationProps {
  tabs?: TabsProp;                               // <-- now optional
  activeTab: string;
  setActiveTab: React.Dispatch<React.SetStateAction<string>>;
  town?: string;
}

export default function BottomNavigation({
  tabs,
  activeTab,
  setActiveTab,
  town = "Lagawe",
}: BottomNavigationProps) {
  const router = useRouter();

  // Safe default used when pages forget to pass `tabs`
  const DEFAULT_TABS: TabItem[] = [
    { key: "rides",    label: "Rides" },
    { key: "delivery", label: "Deliveries" },
    { key: "errands",  label: "Errands" },
    { key: "map",      label: "Map" },
    { key: "profile",  label: "Profile" },
  ];

  // Normalize strings/objects and fallback if `tabs` is missing
  const normalized: TabItem[] = (tabs ?? DEFAULT_TABS).map((t) =>
    typeof t === "string"
      ? { key: t.trim().toLowerCase().replace(/\s+/g, ""), label: t }
      : { key: t.key.trim().toLowerCase().replace(/\s+/g, ""), label: t.label }
  );

  // Town color legend
  const townColors: Record<string, string> = {
    Lagawe: "text-[#800000]",
    Kiangan: "text-[#008000]",
    Banaue: "text-[#0066cc]",
    Lamut: "text-[#ff6600]",
    Hingyon: "text-[#800080]",
  };
  const activeColor = townColors[town] || "text-blue-600";

  // Icons
  const icons: Record<string, JSX.Element> = {
    rides: <Home size={22} />,
    delivery: <Package size={22} />,
    deliveries: <Package size={22} />, // alias tolerance
    errands: <ShoppingBag size={22} />,
    map: <MapPin size={22} />,
    profile: <User size={22} />,
  };

  const handleClick = (tab: TabItem) => {
    setActiveTab(tab.label);
    router.push(`/${tab.key}`);
  };

  return (
    <nav className="fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 shadow-md flex justify-around py-2 z-50">
      {normalized.map((tab) => (
        <button
          key={tab.key}
          onClick={() => handleClick(tab)}
          className={`flex flex-col items-center text-xs font-medium transition-colors duration-150 ${
            activeTab === tab.label ? activeColor : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {icons[tab.key] ?? <Home size={22} />}
          <span className="mt-1">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
