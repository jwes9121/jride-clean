"use client";

import React, { useState, useEffect } from "react";
import OfflineIndicator from "@/components/OfflineIndicator";

export default function VendorOrdersPage() {
  const [cart, setCart] = useState<{ id: number; quantity: number }[]>([]);

  // Example: mock fetch orders
  useEffect(() => {
    // TODO: Replace with real fetch logic
    setCart([{ id: 1, quantity: 2 }, { id: 2, quantity: 3 }]);
  }, []);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <OfflineIndicator />

      {/* Header */}
      <header className="p-4 bg-white shadow">
        <h1 className="text-xl font-bold">Vendor Orders ({cartCount})</h1>
      </header>

      {/* Orders List */}
      <main className="p-4">
        {cart.length === 0 ? (
          <p className="text-gray-600">No items in your cart.</p>
        ) : (
          <ul className="space-y-2">
            {cart.map((item) => (
              <li
                key={item.id}
                className="p-3 border rounded bg-white shadow-sm flex justify-between"
              >
                <span>Item #{item.id}</span>
                <span>Qty: {item.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
