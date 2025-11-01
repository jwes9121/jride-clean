"use client";
import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';

interface User {
  id: string;
  email?: string;
  phone?: string;
  user_metadata?: {
    full_name?: string;
    verification_status?: string;
  };
}

export default function WebsiteAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const supabase = createClientComponentClient();

  useEffect(() => {
    // Get initial session
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      setLoading(false);
    };

    getSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user || null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }

    setLoginLoading(true);
    setError('');

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        // Try phone login if email fails
        if (email.includes('+63') || email.startsWith('09') || email.startsWith('9')) {
          const formattedPhone = email.startsWith('+63') 
            ? email 
            : `+63${email.replace(/^0/, '')}`;
          
          const { error: phoneError } = await supabase.auth.signInWithPassword({
            phone: formattedPhone,
            password,
          });

          if (phoneError) throw phoneError;
        } else {
          throw signInError;
        }
      }

      setShowLoginModal(false);
      setEmail('');
      setPassword('');
    } catch (err: any) {
      setError('Invalid login credentials');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // If user is logged in, show dashboard
  if (user) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center">
                  <span className="text-white font-['Pacifico'] text-lg">J</span>
                </div>
                <div>
                  <h1 className="text-xl font-['Pacifico'] text-orange-500">J-Ride</h1>
                  <p className="text-xs text-gray-500">Passenger Dashboard</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">
                    {user.user_metadata?.full_name || user.email || user.phone}
                  </p>
                  <p className="text-xs text-gray-500">
                    {user.user_metadata?.verification_status || 'Unverified'}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1 rounded-lg hover:bg-gray-100"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to J-Ride</h2>
            <p className="text-gray-600">Choose a service to get started</p>
          </div>

          {/* Services Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Book a Ride */}
            <Link href="/ride">
              <div className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow cursor-pointer border border-gray-200">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="ri-motorbike-line text-2xl text-blue-600"></i>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">Book a Ride</h3>
                <p className="text-sm text-gray-600 text-center">Safe and reliable tricycle rides</p>
              </div>
            </Link>

            {/* Food Delivery */}
            <Link href="/delivery">
              <div className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow cursor-pointer border border-gray-200">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="ri-restaurant-line text-2xl text-red-600"></i>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">Food Delivery</h3>
                <p className="text-sm text-gray-600 text-center">Fresh food from local restaurants</p>
              </div>
            </Link>

            {/* Errands */}
            <Link href="/errand">
              <div className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow cursor-pointer border border-gray-200">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="ri-shopping-bag-line text-2xl text-green-600"></i>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">Errands</h3>
                <p className="text-sm text-gray-600 text-center">Grocery shopping and deliveries</p>
              </div>
            </Link>

            {/* AgriMarket */}
            <Link href="/vendor-orders">
              <div className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow cursor-pointer border border-gray-200">
                <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="ri-plant-line text-2xl text-yellow-600"></i>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">AgriMarket</h3>
                <p className="text-sm text-gray-600 text-center">Fresh local produce and goods</p>
              </div>
            </Link>
          </div>

          {/* Quick Stats */}
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <i className="ri-car-line text-blue-600 text-xl"></i>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">0</p>
                  <p className="text-sm text-gray-600">Total Rides</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                  <i className="ri-wallet-line text-green-600 text-xl"></i>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">â‚±0</p>
                  <p className="text-sm text-gray-600">Wallet Balance</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                  <i className="ri-star-line text-orange-600 text-xl"></i>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">0</p>
                  <p className="text-sm text-gray-600">Reward Points</p>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="mt-12">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="text-center py-8">
                <i className="ri-history-line text-4xl text-gray-300 mb-4"></i>
                <p className="text-gray-500">No recent activity</p>
                <p className="text-sm text-gray-400 mt-1">Your ride history will appear here</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Login page for website
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white rounded-full mx-auto flex items-center justify-center shadow-2xl mb-4">
            <span className="text-3xl font-['Pacifico'] text-orange-500">J</span>
          </div>
          <h1 className="text-4xl font-['Pacifico'] text-white mb-2">J-Ride</h1>
          <p className="text-orange-200">Web Dashboard</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-6">Sign In</h2>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email or Phone
              </label>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                placeholder="Enter your email or phone number"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                placeholder="Enter your password"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full bg-orange-500 text-white py-3 rounded-xl font-semibold hover:bg-orange-600 disabled:bg-orange-300 disabled:cursor-not-allowed transition-colors"
            >
              {loginLoading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{' '}
              <Link href="/mobile-app" className="text-orange-500 hover:text-orange-600 font-medium">
                Use Mobile App to Sign Up
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
              â† Back to Homepage
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}







