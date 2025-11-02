"use client";
import React, { useState, useEffect } from 'react';
export default function OfflinePage() {
  const [activeTab, setActiveTab] = useState('home');
  const [showAuthModal, setShowAuthModal] = useState(false);
  return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center p-6'>
      <div className='max-w-md w-full bg-white rounded-2xl border shadow-sm p-6 text-center'>
        <div className='w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-3'>
          <span style={{fontSize:'24px'}}>âš ï¸</span>
        </div>
        <h1 className='text-xl font-bold text-gray-900 mb-2'>You are offline</h1>
        <p className='text-gray-600 text-sm'>
          Don&apos;t worryâ€”your recent pages and data may still be available.
          We&apos;ll reconnect automatically as soon as you&apos;re back online.
        </p>
      </div>
    </div>
  );
}







