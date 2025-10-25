'use client';

import { useState, useEffect } from 'react';

interface Transaction {
  id: string;
  transaction_id: string;
  type: string;
  amount: number;
  fee_amount?: number;
  net_amount: number;
  description: string;
  status: string;
  payment_method?: string;
  trip_reference?: string;
  fare_amount?: number;
  commission_rate?: number;
  driver_net_earnings?: number;
  created_at: string;
  completed_at?: string;
  payment_details?: any;
}

interface LedgerSummary {
  current_balance: number;
  cash_trips: {
    count: number;
    total_fares: number;
    total_commissions_deducted: number;
    net_cash_received: number;
  };
  online_trips: {
    count: number;
    total_fares: number;
    total_commissions_deducted: number;
    net_credited: number;
  };
  cashouts: {
    count: number;
    total_amount: number;
    total_fees: number;
    net_received: number;
  };
}

interface DriverWalletLedgerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DriverWalletLedger({ isOpen, onClose }: DriverWalletLedgerProps) {
  const [ledgerData, setLedgerData] = useState<{
    current_balance: number;
    ledger_summary: LedgerSummary;
    recent_transactions: Transaction[];
    commission_history: any[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'transactions' | 'commissions'>('summary');

  useEffect(() => {
    if (isOpen) {
      fetchLedgerData();
    }
  }, [isOpen]);

  const fetchLedgerData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('j-ride-token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/wallet-service`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'get_driver_ledger'
        })
      });

      const data = await response.json();
      if (data.success) {
        setLedgerData(data);
      }
    } catch (error) {
      console.error('Error fetching ledger data:', error);
    }
    setLoading(false);
  };

  if (!isOpen) return null;

  const formatCurrency = (amount: number) => `â‚±${amount.toFixed(2)}`;
  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString();
  const formatDateTime = (dateString: string) => new Date(dateString).toLocaleString();

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'commission_deduction': return 'ri-arrow-down-line text-red-500';
      case 'trip_earnings': return 'ri-arrow-up-line text-green-500';
      case 'driver_cashout': return 'ri-bank-line text-blue-500';
      case 'emergency_payout': return 'ri-alarm-line text-orange-500';
      case 'weekly_payout': return 'ri-calendar-line text-purple-500';
      default: return 'ri-exchange-line text-gray-500';
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'commission_deduction': return 'text-red-600';
      case 'trip_earnings': return 'text-green-600';
      case 'driver_cashout': return 'text-blue-600';
      case 'emergency_payout': return 'text-orange-600';
      case 'weekly_payout': return 'text-purple-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-blue-500 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Driver Wallet Ledger</h2>
              <p className="text-green-100">Transparent commission and earnings tracking</p>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
            >
              <i className="ri-close-line text-xl"></i>
            </button>
          </div>

          {ledgerData && (
            <div className="mt-4 text-center">
              <div className="text-3xl font-bold">{formatCurrency(ledgerData.current_balance)}</div>
              <div className="text-green-100">Current Wallet Balance</div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p>Loading ledger data...</p>
          </div>
        ) : ledgerData ? (
          <div className="flex flex-col h-full">
            {/* Tabs */}
            <div className="flex border-b">
              <button
                onClick={() => setActiveTab('summary')}
                className={`flex-1 py-4 px-6 font-medium ${
                  activeTab === 'summary'
                    ? 'border-b-2 border-green-500 text-green-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                Summary
              </button>
              <button
                onClick={() => setActiveTab('transactions')}
                className={`flex-1 py-4 px-6 font-medium ${
                  activeTab === 'transactions'
                    ? 'border-b-2 border-green-500 text-green-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                Transactions
              </button>
              <button
                onClick={() => setActiveTab('commissions')}
                className={`flex-1 py-4 px-6 font-medium ${
                  activeTab === 'commissions'
                    ? 'border-b-2 border-green-500 text-green-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                Commissions
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {/* Summary Tab */}
              {activeTab === 'summary' && (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold mb-2">30-Day Summary</h3>
                    <p className="text-gray-600">Your earnings and deductions breakdown</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Cash Trips Summary */}
                    <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                      <div className="flex items-center space-x-3 mb-4">
                        <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
                          <i className="ri-money-dollar-circle-line text-red-600 text-xl"></i>
                        </div>
                        <div>
                          <h4 className="font-bold text-red-900">Cash Trips</h4>
                          <p className="text-sm text-red-700">Commission deducted from wallet</p>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-red-700">Total trips:</span>
                          <span className="font-semibold">{ledgerData.ledger_summary.cash_trips.count}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-red-700">Total fares collected:</span>
                          <span className="font-semibold">{formatCurrency(ledgerData.ledger_summary.cash_trips.total_fares)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-red-700">Commission deducted:</span>
                          <span className="font-semibold text-red-600">-{formatCurrency(ledgerData.ledger_summary.cash_trips.total_commissions_deducted)}</span>
                        </div>
                        <div className="border-t border-red-200 pt-2">
                          <div className="flex justify-between">
                            <span className="font-medium text-red-800">Net cash received:</span>
                            <span className="font-bold text-green-600">{formatCurrency(ledgerData.ledger_summary.cash_trips.net_cash_received)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Online Trips Summary */}
                    <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                      <div className="flex items-center space-x-3 mb-4">
                        <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                          <i className="ri-smartphone-line text-green-600 text-xl"></i>
                        </div>
                        <div>
                          <h4 className="font-bold text-green-900">Online Trips</h4>
                          <p className="text-sm text-green-700">Net earnings credited to wallet</p>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-green-700">Total trips:</span>
                          <span className="font-semibold">{ledgerData.ledger_summary.online_trips.count}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-green-700">Total fares received:</span>
                          <span className="font-semibold">{formatCurrency(ledgerData.ledger_summary.online_trips.total_fares)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-green-700">Commission deducted:</span>
                          <span className="font-semibold text-red-600">-{formatCurrency(ledgerData.ledger_summary.online_trips.total_commissions_deducted)}</span>
                        </div>
                        <div className="border-t border-green-200 pt-2">
                          <div className="flex justify-between">
                            <span className="font-medium text-green-800">Net credited to wallet:</span>
                            <span className="font-bold text-green-600">+{formatCurrency(ledgerData.ledger_summary.online_trips.net_credited)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Cashouts Summary */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 md:col-span-2">
                      <div className="flex items-center space-x-3 mb-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                          <i className="ri-bank-line text-blue-600 text-xl"></i>
                        </div>
                        <div>
                          <h4 className="font-bold text-blue-900">Cashouts & Payouts</h4>
                          <p className="text-sm text-blue-700">Money transferred from wallet</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
                        <div>
                          <div className="text-2xl font-bold text-blue-600">{ledgerData.ledger_summary.cashouts.count}</div>
                          <div className="text-sm text-blue-700">Total cashouts</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-blue-600">{formatCurrency(ledgerData.ledger_summary.cashouts.total_amount)}</div>
                          <div className="text-sm text-blue-700">Gross amount</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-red-600">{formatCurrency(ledgerData.ledger_summary.cashouts.total_fees)}</div>
                          <div className="text-sm text-blue-700">Service fees</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-green-600">{formatCurrency(ledgerData.ledger_summary.cashouts.net_received)}</div>
                          <div className="text-sm text-blue-700">Net received</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Transactions Tab */}
              {activeTab === 'transactions' && (
                <div className="space-y-4">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold mb-2">Recent Transactions</h3>
                    <p className="text-gray-600">Last 100 wallet activities</p>
                  </div>

                  {ledgerData.recent_transactions.map((transaction) => (
                    <div key={transaction.id} className="bg-gray-50 rounded-xl p-4 border">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
                            <i className={getTransactionIcon(transaction.type)}></i>
                          </div>
                          <div>
                            <div className="font-semibold">{transaction.description}</div>
                            <div className="text-sm text-gray-600">
                              {formatDateTime(transaction.completed_at || transaction.created_at)}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-lg font-bold ${getTransactionColor(transaction.type)}`}>
                            {transaction.amount >= 0 ? '+' : ''}{formatCurrency(transaction.amount)}
                          </div>
                          <div className="text-sm text-gray-600">{transaction.status}</div>
                        </div>
                      </div>

                      {/* Trip-specific details */}
                      {(transaction.type === 'commission_deduction' || transaction.type === 'trip_earnings') && (
                        <div className="bg-white rounded-lg p-3 mt-3">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-gray-600">Trip ID:</span>
                              <span className="font-medium ml-2">{transaction.trip_reference}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">Fare Amount:</span>
                              <span className="font-medium ml-2">{formatCurrency(transaction.fare_amount || 0)}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">Commission Rate:</span>
                              <span className="font-medium ml-2">{((transaction.commission_rate || 0) * 100).toFixed(1)}%</span>
                            </div>
                            <div>
                              <span className="text-gray-600">Payment Method:</span>
                              <span className="font-medium ml-2 capitalize">{transaction.payment_method}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Cashout details */}
                      {(transaction.type === 'driver_cashout' || transaction.type === 'emergency_payout') && transaction.fee_amount && (
                        <div className="bg-white rounded-lg p-3 mt-3">
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <span className="text-gray-600">Gross Amount:</span>
                              <span className="font-medium ml-2">{formatCurrency(transaction.amount)}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">Service Fee:</span>
                              <span className="font-medium ml-2 text-red-600">-{formatCurrency(transaction.fee_amount)}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">Net Received:</span>
                              <span className="font-medium ml-2 text-green-600">{formatCurrency(transaction.net_amount)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Commissions Tab */}
              {activeTab === 'commissions' && (
                <div className="space-y-4">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold mb-2">Commission History</h3>
                    <p className="text-gray-600">Detailed commission breakdown by trip</p>
                  </div>

                  {ledgerData.commission_history.map((commission, index) => (
                    <div key={index} className="bg-gray-50 rounded-xl p-4 border">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="font-semibold">Trip #{commission.trip_id}</div>
                          <div className="text-sm text-gray-600">
                            {formatDateTime(commission.processed_at)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-green-600">
                            {formatCurrency(commission.fare_amount)}
                          </div>
                          <div className="text-sm text-gray-600 capitalize">
                            {commission.payment_method} payment
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-lg p-3">
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">Commission Rate:</span>
                            <span className="font-medium ml-2">{(commission.commission_rate * 100).toFixed(1)}%</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Commission Amount:</span>
                            <span className="font-medium ml-2 text-red-600">
                              -{formatCurrency(commission.commission_amount)}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">Driver Net:</span>
                            <span className="font-medium ml-2 text-green-600">
                              {formatCurrency(commission.fare_amount - commission.commission_amount)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p>No ledger data available</p>
          </div>
        )}
      </div>
    </div>
  );
}


