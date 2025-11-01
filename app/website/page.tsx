'use client';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import WebsiteAuth from './WebsiteAuth';

export default function WebsitePage() {
  const [activeTab, setActiveTab] = useState('home');
  const [showAuthModal, setShowAuthModal] = useState(false);
  return <WebsiteAuth />;
}







