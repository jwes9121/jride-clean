"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import BottomNavigation from '@/components/BottomNavigation';

interface User {
  id: string;
  phone: string;
  full_name?: string;
  user_type: string;
  wallet_balance: number;
}

interface Transaction {
  id: string;
  type: 'credit' | 'debit' | 'topup' | 'payout' | 'ride' | 'errand' | 'vendor_order';
  amount: number;
  description: string;
  status: 'completed' | 'pending' | 'failed';
  created_at: string;
  transaction_id: string;
}

export default function WalletPage() {
  const [user, setUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [referralEarnings, setReferralEarnings] = useState(0);

  useEffect(() => {
    loadWalletData();
    loadReferralEarnings();
  }, []);

  const loadReferralEarnings = async () => {
    try {
      const token = localStorage.getItem('j-ride-token');
      const user = JSON.parse(localStorage.getItem('j-ride-user') || '{}');

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/referral-system`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'get_referral_stats',
          userId: user.id
        })
      });

      const data = await response.json();
      if (data.success) {
        setReferralEarnings(data.stats.totalEarnings || 0);
      }
    } catch (error) {
      console.error('Error loading referral earnings:', error);
    }
  };

  useEffect(() => {
    loadWalletData();
  }, []);

  const loadWalletData = async () => {
    try {
      const userData = localStorage.getItem('j-ride-user');
      if (userData) {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
        
        // Load transaction history
        const token = localStorage.getItem('j-ride-token');
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/wallet-service`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            action: 'get_transactions'
          })
        });

        const data = await response.json();
        if (data.success) {
          setTransactions(data.transactions || []);
        }
      }
    } catch (error) {
      console.error('Error loading wallet data:', error);
    }
    setLoading(false);
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'credit':
      case 'topup':
        return 'ri-add-circle-line';
      case 'referral_bonus':
        return 'ri-user-add-line';
      case 'debit':
      case 'payout':
        return 'ri-subtract-line';
      case 'ride':
        return 'ri-taxi-line';
      case 'errand':
        return 'ri-shopping-bag-line';
      case 'vendor_order':
        return 'ri-restaurant-line';
      default:
        return 'ri-money-dollar-circle-line';
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'credit':
      case 'topup':
        return 'text-green-600';
      case 'referral_bonus':
        return 'text-purple-600';
      case 'debit':
      case 'payout':
        return 'text-red-600';
      default:
        return 'text-blue-600';
    }
  };

  const formatAmount = (amount: number, type: string) => {
    const prefix = ['credit', 'topup'].includes(type) ? '+' : '-';
    return `${prefix}Ã¢â€šÂ±${Math.abs(amount).toFixed(2)}`;
  };

  const canAcceptBookings = () => {
    if (!user || user.user_type === 'passenger') return true;
    return user.wallet_balance >= 100;
  };

  const showLowBalanceWarning = () => {
    if (!user || user.user_type === 'passenger') return false;
    return user.wallet_balance <= 200 && user.wallet_balance >= 100;
  };

  const showBookingLocked = () => {
    if (!user || user.user_type === 'passenger') return false;
    return user.wallet_balance < 100;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading wallet...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Please sign in to view your wallet</p>
          <Link href="/" className="bg-orange-500 text-white px-6 py-3 rounded-xl font-semibold">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-gradient-to-br from-orange-500 to-red-500 p-6 text-white">
        <div className="flex items-center justify-between mb-6">
          <Link href="/">
            <button className="w-10 h-10 flex items-center justify-center">
              <i className="ri-arrow-left-line text-xl text-white"></i>
            </button>
          </Link>
          <h1 className="text-xl font-bold">My Wallet</h1>
          <div className="w-10"></div>
        </div>

        <div className="text-center mb-6">
          <div className="text-sm opacity-90 mb-2">Available Balance</div>
          <div className="text-4xl font-bold">Ã¢â€šÂ±{user.wallet_balance.toFixed(2)}</div>
          <div className="text-sm opacity-80 mt-1">
            {user.user_type === 'passenger' ? 'Passenger Account' : 
             user.user_type === 'driver' ? 'Driver Account' : 'Vendor Account'}
          </div>
        </div>

        {showLowBalanceWarning() && (
          <div className="bg-yellow-500/20 border border-yellow-300 rounded-xl p-3 mb-4">
            <div className="flex items-center space-x-2">
              <i className="ri-alert-line text-yellow-200"></i>
              <span className="text-sm">Ã¢Å¡Â  Low Wallet Balance, please top-up to continue accepting {user.user_type === 'driver' ? 'rides' : 'orders'}.</span>
            </div>
          </div>
        )}

        {showBookingLocked() && (
          <div className="bg-red-500/20 border border-red-300 rounded-xl p-3 mb-4">
            <div className="flex items-center space-x-2">
              <i className="ri-lock-line text-red-200"></i>
              <span className="text-sm">Ã°Å¸Å¡Â« Booking locked. Minimum Ã¢â€šÂ±100 balance required to accept bookings.</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Link href="/wallet/topup">
            <button className="bg-white/20 backdrop-blur-sm p-4 rounded-xl text-center">
              <i className="ri-add-circle-line text-2xl mb-2"></i>
              <div className="text-sm font-medium">Top Up</div>
            </button>
          </Link>
          {(user.user_type === 'driver' || user.user_type === 'vendor') && (
            <Link href="/wallet/cashout">
              <button className="bg-white/20 backdrop-blur-sm p-4 rounded-xl text-center">
                <i className="ri-bank-line text-2xl mb-2"></i>
                <div className="text-sm font-medium">Cash Out</div>
              </button>
            </Link>
          )}
          {user.user_type === 'passenger' && (
            <button className="bg-white/20 backdrop-blur-sm p-4 rounded-xl text-center opacity-50">
              <i className="ri-gift-line text-2xl mb-2"></i>
              <div className="text-sm font-medium">Rewards</div>
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex-1 p-4 text-center font-medium ${
                activeTab === 'overview' 
                  ? 'text-orange-500 border-b-2 border-orange-500' 
                  : 'text-gray-600'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 p-4 text-center font-medium ${
                activeTab === 'history' 
                  ? 'text-orange-500 border-b-2 border-orange-500' 
                  : 'text-gray-600'
              }`}
            >
              History
            </button>
          </div>

          {activeTab === 'overview' && (
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-50 p-4 rounded-xl">
                  <div className="text-green-600 text-sm font-medium">Total Income</div>
                  <div className="text-xl font-bold text-green-700">
                    Ã¢â€šÂ±{transactions
                      .filter(t => ['credit', 'topup', 'referral_bonus'].includes(t.type) && t.status === 'completed')
                      .reduce((sum, t) => sum + t.amount, 0)
                      .toFixed(2)}
                  </div>
                </div>
                <div className="bg-red-50 p-4 rounded-xl">
                  <div className="text-red-600 text-sm font-medium">Total Spent</div>
                  <div className="text-xl font-bold text-red-700">
                    Ã¢â€šÂ±{transactions
                      .filter(t => ['debit', 'payout', 'ride', 'errand', 'vendor_order'].includes(t.type) && t.status === 'completed')
                      .reduce((sum, t) => sum + t.amount, 0)
                      .toFixed(2)}
                  </div>
                </div>
              </div>

              {referralEarnings > 0 && (
                <div className="bg-purple-50 p-4 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <i className="ri-user-add-line text-purple-600"></i>
                      <span className="text-purple-600 font-medium">Referral Earnings</span>
                    </div>
                    <span className="text-xl font-bold text-purple-600">Ã¢â€šÂ±{referralEarnings}</span>
                  </div>
                  <div className="text-sm text-purple-600 mt-1">
                    From successful referrals
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <h3 className="font-semibold">Pending Transactions</h3>
                {transactions.filter(t => t.status === 'pending').length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <i className="ri-check-double-line text-3xl mb-2"></i>
                    <p>No pending transactions</p>
                  </div>
                ) : (
                  transactions.filter(t => t.status === 'pending').map((transaction) => (
                    <div key={transaction.id} className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
                          <i className={`${getTransactionIcon(transaction.type)} ${getTransactionColor(transaction.type)}`}></i>
                        </div>
                        <div>
                          <div className="font-medium">{transaction.description}</div>
                          <div className="text-xs text-gray-600">ID: {transaction.transaction_id}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-semibold ${getTransactionColor(transaction.type)}`}>
                          {formatAmount(transaction.amount, transaction.type)}
                        </div>
                        <div className="text-xs text-yellow-600">Pending</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="p-4">
              {transactions.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <i className="ri-history-line text-4xl mb-4"></i>
                  <p>No transaction history yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {transactions.map((transaction) => (
                    <div key={transaction.id} className="flex items-center justify-between p-3 border-b border-gray-100 last:border-b-0">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                          <i className={`${getTransactionIcon(transaction.type)} ${getTransactionColor(transaction.type)}`}></i>
                        </div>
                        <div>
                          <div className="font-medium">{transaction.description}</div>
                          <div className="text-xs text-gray-600">
                            {new Date(transaction.created_at).toLocaleString()}
                          </div>
                          <div className="text-xs text-gray-500">ID: {transaction.transaction_id}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-semibold ${getTransactionColor(transaction.type)}`}>
                          {formatAmount(transaction.amount, transaction.type)}
                        </div>
                        <div className={`text-xs ${
                          transaction.status === 'completed' ? 'text-green-600' :
                          transaction.status === 'pending' ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {user.user_type !== 'passenger' && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="font-semibold text-blue-800 mb-2">
              {user.user_type === 'driver' ? 'Driver' : 'Vendor'} Requirements
            </h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>Ã¢â‚¬Â¢ Minimum top-up: Ã¢â€šÂ±500 (first registration)</li>
              <li>Ã¢â‚¬Â¢ Minimum balance to accept bookings: Ã¢â€šÂ±100</li>
              <li>Ã¢â‚¬Â¢ Auto-notification at Ã¢â€šÂ±200 balance</li>
              <li>Ã¢â‚¬Â¢ Company share deducted automatically</li>
            </ul>
          </div>
        )}

        {user.user_type === 'passenger' && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
            <h3 className="font-semibold text-green-800 mb-2">Passenger Benefits</h3>
            <ul className="text-sm text-green-700 space-y-1">
              <li>Ã¢â‚¬Â¢ Minimum top-up: Ã¢â€šÂ±50</li>
              <li>Ã¢â‚¬Â¢ No booking limits</li>
              <li>Ã¢â‚¬Â¢ Cash payment option available</li>
              <li>Ã¢â‚¬Â¢ Use wallet for rides, errands & vendor orders</li>
            </ul>
          </div>
        )}
      </div>

      <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}







