"use client";
import React, { useState, useEffect } from 'react';
import BottomNavigation from '@/components/BottomNavigation';

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState('history');

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="p-4">
        <h1 className="text-xl font-bold">Ride History</h1>
        {/* Ride history content goes here */}
      </div>

      <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}







