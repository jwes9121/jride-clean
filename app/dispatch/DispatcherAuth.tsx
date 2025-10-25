"use client";
import React, { useState, useEffect } from 'react';
interface DispatcherAuthProps {
  onLogin: () => void;
}

export default function DispatcherAuth({ onLogin }: DispatcherAuthProps) {
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
    dispatcherId: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Simulate authentication - replace with actual Supabase call
      if (credentials.username && credentials.password && credentials.dispatcherId) {
        localStorage.setItem('dispatcher_authenticated', 'true');
        localStorage.setItem('dispatcher_id', credentials.dispatcherId);
        localStorage.setItem('dispatcher_username', credentials.username);
        onLogin();
      } else {
        setError('Please fill in all fields');
      }
    } catch (err) {
      setError('Authentication failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <i className="ri-car-line text-white text-2xl"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">J-Ride Dispatch</h1>
          <p className="text-gray-600">Dispatcher Portal Access</p>
        </div>

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Username
            </label>
            <input
              type="text"
              value={credentials.username}
              onChange={(e) => setCredentials(prev => ({ ...prev, username: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your username"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your password"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Dispatcher ID
            </label>
            <input
              type="text"
              value={credentials.dispatcherId}
              onChange={(e) => setCredentials(prev => ({ ...prev, dispatcherId: e.target.value }))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your dispatcher ID"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <div className="flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                Logging in...
              </div>
            ) : (
              'Login to Dispatch Portal'
            )}
          </button>
        </form>

        {/* Info */}
        <div className="mt-6 p-4 bg-blue-50 rounded-xl">
          <div className="flex items-start space-x-3">
            <i className="ri-information-line text-blue-600 text-lg mt-0.5"></i>
            <div>
              <h3 className="text-sm font-medium text-blue-900 mb-1">Access Instructions</h3>
              <ul className="text-xs text-blue-700 space-y-1">
                <li>â€¢ Contact admin for dispatcher credentials</li>
                <li>â€¢ Use your assigned Dispatcher ID</li>
                <li>â€¢ Portal works on mobile browsers</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}







