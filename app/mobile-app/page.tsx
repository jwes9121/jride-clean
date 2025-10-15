"use client";
import React, { useState, useEffect } from 'react';
import BottomNavigation from '@/components/BottomNavigation';

export default function MobileAppPage() {
  const [activeTab, setActiveTab] = useState('home');

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <main className="p-4">
        <h1 className="text-xl font-bold">Mobile App</h1>
        {/* Mobile app content goes here */}
      </main>

      <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}





