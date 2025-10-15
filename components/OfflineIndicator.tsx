
'use client';

import { useState, useEffect, useRef } from 'react';
import { getOfflineQueue } from '@/lib/offlineQueue';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [queueLength, setQueueLength] = useState(0);
  const [showNotification, setShowNotification] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    setMounted(true);

    const offlineQueue = getOfflineQueue();

    const updateStatus = () => {
      if (!isMountedRef.current) return;
      
      const online = offlineQueue.isOnlineStatus();
      const length = offlineQueue.getQueueLength();
      
      setIsOnline(online);
      setQueueLength(length);
    };

    const handleOnline = () => {
      if (!isMountedRef.current) return;
      
      updateStatus();
      const currentLength = offlineQueue.getQueueLength();
      if (currentLength > 0) {
        setShowNotification(true);
        setTimeout(() => {
          if (isMountedRef.current) {
            setShowNotification(false);
          }
        }, 3000);
      }
    };

    const handleOffline = () => {
      if (!isMountedRef.current) return;
      
      updateStatus();
      setShowNotification(true);
      setTimeout(() => {
        if (isMountedRef.current) {
          setShowNotification(false);
        }
      }, 3000);
    };

    const handleBookingSync = () => {
      if (!isMountedRef.current) return;
      
      updateStatus();
      setShowNotification(true);
      setTimeout(() => {
        if (isMountedRef.current) {
          setShowNotification(false);
        }
      }, 3000);
    };

    const handleRequestFailed = () => {
      if (!isMountedRef.current) return;
      
      updateStatus();
      setShowNotification(true);
      setTimeout(() => {
        if (isMountedRef.current) {
          setShowNotification(false);
        }
      }, 5000);
    };

    // Initial status update
    setTimeout(updateStatus, 100);

    // Set up event listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      window.addEventListener('offlineBookingSync', handleBookingSync);
      window.addEventListener('offlineRequestFailed', handleRequestFailed);
    }

    // Regular status updates
    const interval = setInterval(updateStatus, 2000);

    return () => {
      isMountedRef.current = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('offlineBookingSync', handleBookingSync);
        window.removeEventListener('offlineRequestFailed', handleRequestFailed);
      }
      clearInterval(interval);
    };
  }, []);

  if (!mounted || (!showNotification && isOnline && queueLength === 0)) {
    return null;
  }

  return (
    <div className="fixed top-20 left-4 right-4 z-40">
      {!isOnline && (
        <div className="bg-red-500 text-white px-4 py-3 rounded-xl shadow-lg mb-2">
          <div className="flex items-center space-x-2">
            <i className="ri-wifi-off-line"></i>
            <span className="text-sm font-medium">You're offline</span>
          </div>
          <p className="text-xs mt-1">Bookings will be saved and sent when connection returns</p>
        </div>
      )}

      {queueLength > 0 && (
        <div className="bg-orange-500 text-white px-4 py-3 rounded-xl shadow-lg mb-2">
          <div className="flex items-center space-x-2">
            <i className="ri-time-line"></i>
            <span className="text-sm font-medium">
              {queueLength} booking{queueLength > 1 ? 's' : ''} queued
            </span>
          </div>
          <p className="text-xs mt-1">
            {isOnline ? 'Syncing...' : 'Will sync when online'}
          </p>
        </div>
      )}

      {showNotification && isOnline && queueLength === 0 && (
        <div className="bg-green-500 text-white px-4 py-3 rounded-xl shadow-lg">
          <div className="flex items-center space-x-2">
            <i className="ri-check-line"></i>
            <span className="text-sm font-medium">Back online</span>
          </div>
          <p className="text-xs mt-1">All queued bookings have been synced</p>
        </div>
      )}
    </div>
  );
}
