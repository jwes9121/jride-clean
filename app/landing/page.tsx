"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState('home');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);

  useEffect(() => {
    setShowAnimation(true);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 flex flex-col items-center justify-center p-4">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-10 left-10 w-20 h-20 bg-white rounded-full animate-pulse"></div>
        <div className="absolute top-32 right-20 w-16 h-16 bg-white rounded-full animate-pulse delay-1000"></div>
        <div className="absolute bottom-20 left-20 w-12 h-12 bg-white rounded-full animate-pulse delay-2000"></div>
        <div className="absolute bottom-40 right-10 w-24 h-24 bg-white rounded-full animate-pulse delay-500"></div>
      </div>

      <div className={`w-full max-w-md mx-auto text-center space-y-8 transform transition-all duration-1000 ${showAnimation ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>

        {/* Logo Section */}
        <div className="space-y-4">
          <div className="w-24 h-24 bg-white rounded-full mx-auto flex items-center justify-center shadow-2xl">
            <span className="text-3xl font-['Pacifico'] text-orange-500">J</span>
          </div>

          <div>
            <h1 className="text-4xl font-['Pacifico'] text-white mb-2">J-Ride</h1>
            <p className="text-orange-100 text-lg font-medium">Ride. Eat. Repeat.</p>
            <p className="text-orange-200 text-sm mt-2">Ã°Å¸â€¡ÂµÃ°Å¸â€¡Â­ Lagawe, Ifugao</p>
          </div>
        </div>

        {/* Welcome Message */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
          <h2 className="text-2xl font-bold text-white mb-3">Welcome to J-Ride!</h2>
          <p className="text-orange-100 text-sm leading-relaxed">
            Choose how you'd like to experience our services - use our mobile app for quick rides and deliveries, or explore our website to learn more about us.
          </p>
        </div>

        {/* Choice Buttons */}
        <div className="space-y-4">

          {/* Use App Option */}
          <Link href="/">
            <div className="group bg-white rounded-2xl p-6 shadow-2xl hover:shadow-3xl transform hover:scale-105 transition-all duration-300 cursor-pointer">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                  <i className="ri-smartphone-line text-2xl text-white"></i>
                </div>
                <div className="flex-1 text-left">
                  <h3 className="text-xl font-bold text-gray-800 mb-1">Use J-Ride App</h3>
                  <p className="text-gray-600 text-sm">Book rides, order food, send errands</p>
                  <div className="flex items-center mt-2 space-x-2">
                    <span className="text-xs bg-orange-100 text-orange-600 px-2 py-1 rounded-full">Ã°Å¸Å¡Â² Rides</span>
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full">Ã°Å¸Ââ€ Food</span>
                    <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full">Ã°Å¸â€œÂ¦ Errands</span>
                  </div>
                </div>
                <i className="ri-arrow-right-line text-gray-400 group-hover:text-orange-500 transition-colors"></i>
              </div>
            </div>
          </Link>

          {/* Visit Website Option */}
          <Link href="/website">
            <div className="group bg-white/90 backdrop-blur-sm rounded-2xl p-6 border-2 border-white/30 hover:bg-white hover:border-white transition-all duration-300 cursor-pointer">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                  <i className="ri-global-line text-2xl text-white"></i>
                </div>
                <div className="flex-1 text-left">
                  <h3 className="text-xl font-bold text-gray-800 mb-1">Visit Our Website</h3>
                  <p className="text-gray-600 text-sm">Learn more about J-Ride services</p>
                  <div className="flex items-center mt-2 space-x-2">
                    <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full">Ã¢â€žÂ¹Ã¯Â¸Â About</span>
                    <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded-full">Ã°Å¸â€œÅ¾ Contact</span>
                    <span className="text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded-full">Ã°Å¸â€™Â¼ Business</span>
                  </div>
                </div>
                <i className="ri-arrow-right-line text-gray-400 group-hover:text-blue-500 transition-colors"></i>
              </div>
            </div>
          </Link>

        </div>

        {/* Features Preview */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
          <h4 className="text-white font-semibold mb-3">What makes J-Ride special?</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center space-x-2 text-orange-100">
              <i className="ri-map-pin-line text-orange-300"></i>
              <span>Local Service</span>
            </div>
            <div className="flex items-center space-x-2 text-orange-100">
              <i className="ri-shield-check-line text-green-300"></i>
              <span>Safe & Reliable</span>
            </div>
            <div className="flex items-center space-x-2 text-orange-100">
              <i className="ri-time-line text-blue-300"></i>
              <span>24/7 Available</span>
            </div>
            <div className="flex items-center space-x-2 text-orange-100">
              <i className="ri-money-dollar-circle-line text-yellow-300"></i>
              <span>Fair Pricing</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center space-y-2">
          <p className="text-orange-200 text-xs">
            Proudly serving Lagawe, Ifugao since 2024
          </p>
          <p className="text-orange-300 text-xs">
            Mabuhay! Your local ride and delivery partner
          </p>
        </div>

        {/* Modified Main CTA Section */}
        <div className="text-center mb-12">
          <div className="flex justify-center space-x-4 mb-8">
            <a
              href="https://app.jride.net"
              className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-semibold text-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
            >
              Use J-Ride App
            </a>
            <a
              href="https://dispatch.jride.net"
              className="bg-green-600 text-white px-8 py-4 rounded-2xl font-semibold text-lg hover:bg-green-700 transition-colors shadow-lg hover:shadow-xl"
            >
              Dispatcher Portal
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <a
            href="https://app.jride.net"
            className="bg-white p-8 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100"
          >
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 mx-auto">
              <i className="ri-smartphone-line text-blue-600 text-2xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">For Passengers</h3>
            <p className="text-gray-600 mb-6">Book rides, track your trips, and manage payments easily</p>
            <div className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg inline-block text-sm font-medium">
              Open App Ã¢â€ â€™
            </div>
          </a>

          <a
            href="https://dispatch.jride.net"
            className="bg-white p-8 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100"
          >
            <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mb-6 mx-auto">
              <i className="ri-headphone-line text-green-600 text-2xl"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">For Dispatchers</h3>
            <p className="text-gray-600 mb-6">Manage bookings, track drivers, and handle operations</p>
            <div className="bg-green-50 text-green-600 px-4 py-2 rounded-lg inline-block text-sm font-medium">
              Open Portal Ã¢â€ â€™
            </div>
          </a>
        </div>

        <div className="bg-blue-50 rounded-2xl p-8 text-center">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">Ready to Experience J-Ride?</h3>
          <p className="text-gray-600 mb-6">Join thousands of satisfied passengers and drivers</p>
          <div className="flex justify-center space-x-4">
            <a
              href="https://app.jride.net"
              className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-semibold hover:bg-blue-700 transition-colors shadow-lg"
            >
              Launch J-Ride App
            </a>
            <a
              href="https://dispatch.jride.net"
              className="bg-white text-blue-600 px-8 py-4 rounded-2xl font-semibold hover:bg-gray-50 transition-colors shadow-lg border border-blue-200"
            >
              Dispatcher Portal
            </a>
          </div>
          <p className="text-sm text-gray-500 mt-4">
            Bookmark: <strong>app.jride.net</strong> (App) Ã¢â‚¬Â¢ <strong>dispatch.jride.net</strong> (Dispatch)
          </p>
        </div>

      </div>
    </div>
  );
}







