"use client";
import React, { useState, useEffect } from 'react';
import BottomNavigation from '@/components/BottomNavigation';

export default function ErrandPage() {
  const [activeTab, setActiveTab] = useState('errand');

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="p-4">
        <h1 className="text-xl font-bold">Errand Dashboard</h1>
        {/* Errand services content goes here */}
      </div>

      <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}







