"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '../../../components/Header';
import BottomNavigation from '../../../components/BottomNavigation';

export default function TopupPage() {
  const [activeTab, setActiveTab] = useState('home');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [phone, setPhone] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');

  const quickAmounts = [50, 100, 200, 500, 1000, 2000];

  useEffect(() => {
    // Get user data from localStorage
    const userData = localStorage.getItem('user_data');
    if (userData) {
      const user = JSON.parse(userData);
      setPhone(user.phone || '');
    }
  }, []);

  const handleTopup = async () => {
    if (!amount || parseFloat(amount) < 1) {
      alert('Please enter a valid amount');
      return;
    }

    if (!phone) {
      alert('Phone number is required for GCash payment');
      return;
    }

    setIsLoading(true);
    
    try {
      const userData = localStorage.getItem('user_data');
      const user = userData ? JSON.parse(userData) : null;

      if (!user?.access_token) {
        alert('Please log in first');
        router.push('/');
        return;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xendit-payment-service`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'create_ewallet_charge',
          amount: parseFloat(amount),
          phone: phone,
          user_id: user.id
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Open payment URL in new window
        const paymentWindow = window.open(data.payment_url, '_blank', 'width=500,height=600');
        
        setPaymentStatus('Processing payment...');
        setShowPaymentModal(true);

        // Poll for payment status
        const checkPayment = async () => {
          try {
            const statusResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xendit-payment-service`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${user.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                action: 'check_payment_status',
                charge_id: data.charge_id
              }),
            });

            const statusData = await statusResponse.json();

            if (statusData.status === 'SUCCEEDED') {
              setPaymentStatus('Payment successful!');
              setTimeout(() => {
                setShowPaymentModal(false);
                router.push('/wallet?payment=success');
              }, 2000);
            } else if (statusData.status === 'FAILED') {
              setPaymentStatus('Payment failed. Please try again.');
              setTimeout(() => {
                setShowPaymentModal(false);
              }, 3000);
            }
          } catch (error) {
            console.error('Error checking payment status:', error);
          }
        };

        // Check payment status every 3 seconds
        const interval = setInterval(checkPayment, 3000);

        // Stop checking after 10 minutes
        setTimeout(() => {
          clearInterval(interval);
          if (paymentStatus === 'Processing payment...') {
            setPaymentStatus('Payment timeout. Please check your GCash app.');
          }
        }, 600000);

      } else {
        alert(`Payment error: ${data.error}`);
      }
    } catch (error) {
      console.error('Topup error:', error);
      alert('Failed to process payment. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Top Up Wallet" />
      
      <div className="pt-16 pb-20 px-4">
        <div className="max-w-md mx-auto space-y-6">
          {/* Amount Input */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Enter Amount</h3>
            
            <div className="relative mb-4">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg">â‚±</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-8 pr-4 py-4 text-xl font-semibold border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
                min="1"
                step="0.01"
              />
            </div>

            {/* Quick Amount Buttons */}
            <div className="grid grid-cols-3 gap-3">
              {quickAmounts.map((quickAmount) => (
                <button
                  key={quickAmount}
                  onClick={() => setAmount(quickAmount.toString())}
                  className="py-3 px-4 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                >
                  â‚±{quickAmount}
                </button>
              ))}
            </div>
          </div>

          {/* Phone Number */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">GCash Number</h3>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09xxxxxxxxx"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500"
            />
            <p className="text-sm text-gray-500 mt-2">
              Make sure this matches your GCash registered number
            </p>
          </div>

          {/* Payment Method */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment Method</h3>
            <div className="flex items-center space-x-3 p-3 bg-blue-50 rounded-xl">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <i className="ri-smartphone-line text-blue-600 text-xl"></i>
              </div>
              <div>
                <p className="font-medium text-gray-900">GCash</p>
                <p className="text-sm text-gray-500">Instant transfer via Xendit</p>
              </div>
            </div>
          </div>

          {/* Top Up Button */}
          <button
            onClick={handleTopup}
            disabled={isLoading || !amount || !phone}
            className="w-full py-4 bg-blue-600 text-white font-semibold rounded-xl disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
          >
            {isLoading ? 'Processing...' : `Top Up â‚±${amount || '0'}`}
          </button>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <div className="flex items-start space-x-3">
              <i className="ri-information-line text-yellow-600 text-lg mt-0.5"></i>
              <div>
                <p className="text-sm font-medium text-yellow-800">Important Notes:</p>
                <ul className="text-xs text-yellow-700 mt-1 space-y-1">
                  <li>â€¢ Minimum top-up amount is â‚±1</li>
                  <li>â€¢ Funds will be added instantly upon successful payment</li>
                  <li>â€¢ Make sure your GCash has sufficient balance</li>
                  <li>â€¢ Transaction fees may apply from GCash</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Status Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                {paymentStatus.includes('successful') ? (
                  <i className="ri-check-line text-green-600 text-2xl"></i>
                ) : paymentStatus.includes('failed') ? (
                  <i className="ri-close-line text-red-600 text-2xl"></i>
                ) : (
                  <div className="animate-spin">
                    <i className="ri-loader-4-line text-blue-600 text-2xl"></i>
                  </div>
                )}
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Payment Status
              </h3>
              <p className="text-gray-600 mb-4">{paymentStatus}</p>
              
              {paymentStatus === 'Processing payment...' && (
                <p className="text-sm text-gray-500">
                  Complete your payment in the GCash window that opened
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}





