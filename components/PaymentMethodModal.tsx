
'use client';

import { useState, useEffect } from 'react';

interface PaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (paymentMethod: 'wallet' | 'cash' | 'points' | 'gcash_xendit') => void;
  rideAmount: number;
}

export default function PaymentMethodModal({ isOpen, onClose, onConfirm, rideAmount }: PaymentMethodModalProps) {
  const xenditEnabled = process.env.NEXT_PUBLIC_XENDIT_ENABLED === '1';

  const [selectedMethod, setSelectedMethod] = useState<'wallet' | 'cash' | 'points' | 'gcash_xendit'>('cash');
  const [walletBalance, setWalletBalance] = useState(0);
  const [rewardPoints, setRewardPoints] = useState(0);
  const [showGCashConfirmation, setShowGCashConfirmation] = useState(false);
  const [gCashFees, setGCashFees] = useState({ percentage: 0, fixed: 0, total: 0 });

  useEffect(() => {
    if (isOpen) {
      // Load user data
      const userData = JSON.parse(localStorage.getItem('j-ride-user') || '{}');
      setWalletBalance(userData.wallet_balance || 0);
      setRewardPoints(userData.reward_points || 0);

      // Calculate GCash fees (2.9% + Ã¢â€šÂ±15)
      const percentageFee = rideAmount * 0.029;
      const fixedFee = 15;
      setGCashFees({
        percentage: percentageFee,
        fixed: fixedFee,
        total: percentageFee + fixedFee
      });
    }
  }, [isOpen, rideAmount]);

  if (!isOpen) return null;

  const canUseWallet = walletBalance >= rideAmount;
  const canUsePoints = rewardPoints >= (rideAmount * 10); // 10 points = Ã¢â€šÂ±1
  const totalGCashCharge = rideAmount + gCashFees.total;

  const handleGCashSelect = () => {
    setSelectedMethod('gcash_xendit');
    setShowGCashConfirmation(true);
  };

  const handleGCashConfirm = () => {
    setShowGCashConfirmation(false);
    onConfirm('gcash_xendit');
  };

  const handleGCashCancel = () => {
    setShowGCashConfirmation(false);
    setSelectedMethod('cash'); // Default back to cash
  };

  const handlePaymentConfirm = () => {
    if (selectedMethod === 'gcash_xendit') {
      handleGCashSelect();
    } else {
      if (((selectedMethod as any) === 'gcash_xendit') && !(process.env.NEXT_PUBLIC_XENDIT_ENABLED === '1')) {
        alert('GCash via Xendit is coming soon (under verification). Please use Cash/Wallet for now.');
        return; // PAYMENTS_TEMP_DISABLED_UI
      }
onConfirm(selectedMethod);
    }
  };

  // GCash Confirmation Screen
  if (showGCashConfirmation) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl p-6 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full mx-auto mb-4 flex items-center justify-center">
              <i className="ri-smartphone-line text-2xl text-blue-600"></i>
            </div>
            <h3 className="text-xl font-bold">GCash Payment Confirmation</h3>
            <p className="text-sm text-gray-600 mt-2">Review your payment details before proceeding</p>
          </div>

          {/* Fee Breakdown */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Ride Fare:</span>
                <span className="font-semibold">Ã¢â€šÂ±{rideAmount.toFixed(2)}</span>
              </div>
              
              <div className="border-t border-gray-200 pt-3">
                <div className="text-sm font-medium text-gray-700 mb-2">Processing Fees:</div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">2.9% fee:</span>
                  <span>Ã¢â€šÂ±{gCashFees.percentage.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Fixed fee:</span>
                  <span>Ã¢â€šÂ±{gCashFees.fixed.toFixed(2)}</span>
                </div>
              </div>
              
              <div className="border-t border-gray-200 pt-3">
                <div className="flex justify-between items-center text-lg font-bold">
                  <span>Total Charge:</span>
                  <span className="text-blue-600">Ã¢â€šÂ±{totalGCashCharge.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Warning Message */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <i className="ri-alert-line text-yellow-600 mt-0.5"></i>
              <div>
                <p className="text-sm font-medium text-yellow-800 mb-1">
                  Ã¢Å¡Â Ã¯Â¸Â Note: Paying via GCash includes processing fees charged by our payment partner.
                </p>
                <p className="text-xs text-yellow-700">
                  To avoid this, you may pay cash directly to your driver.
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            <button
              onClick={handleGCashConfirm}
              className="w-full bg-blue-500 text-white py-4 rounded-xl font-semibold hover:bg-blue-600 transition-colors"
            >
              Proceed with GCash Payment - Ã¢â€šÂ±{totalGCashCharge.toFixed(2)}
            </button>
            
            <button
              onClick={handleGCashCancel}
              className="w-full bg-gray-200 text-gray-800 py-3 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
            >
              Switch to Cash Payment (No Fees)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-100 rounded-full mx-auto mb-4 flex items-center justify-center">
            <i className="ri-wallet-3-line text-2xl text-green-600"></i>
          </div>
          <h3 className="text-xl font-bold">Choose Payment Method</h3>
          <p className="text-sm text-gray-600 mt-2">Fare Amount: Ã¢â€šÂ±{rideAmount.toFixed(2)}</p>
        </div>

        <div className="space-y-3 mb-6">
          {/* Cash Payment - Recommended */}
          <button
            onClick={() => setSelectedMethod('cash')}
            className={`w-full p-4 rounded-xl border-2 transition-colors ${
              selectedMethod === 'cash'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                  <i className="ri-money-dollar-circle-line text-xl text-green-600"></i>
                </div>
                <div className="text-left">
                  <div className="font-semibold flex items-center space-x-2">
                    <span>Cash Payment</span>
                    <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full">RECOMMENDED</span>
                  </div>
                  <div className="text-sm text-gray-600">Pay driver directly - No fees</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-green-600">Ã¢â€šÂ±{rideAmount.toFixed(2)}</div>
                <div className="text-xs text-gray-600">Final amount</div>
              </div>
            </div>
          </button>

          {/* GCash/Xendit Payment */}
          <button
            onClick={() => setSelectedMethod('gcash_xendit')}
            className={`w-full p-4 rounded-xl border-2 transition-colors ${
              selectedMethod === 'gcash_xendit'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <i className="ri-smartphone-line text-xl text-blue-600"></i>
                </div>
                <div className="text-left">
                  <div className="font-semibold">GCash Payment</div>
                  <div className="text-sm text-gray-600">Online payment with fees</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-blue-600">Ã¢â€šÂ±{totalGCashCharge.toFixed(2)}</div>
                <div className="text-xs text-gray-600">+Ã¢â€šÂ±{gCashFees.total.toFixed(2)} fees</div>
              </div>
            </div>
          </button>

          {/* Wallet Payment */}
          <button
            onClick={() => setSelectedMethod('wallet')}
            disabled={!canUseWallet}
            className={`w-full p-4 rounded-xl border-2 transition-colors ${
              selectedMethod === 'wallet'
                ? 'border-orange-500 bg-orange-50'
                : canUseWallet
                ? 'border-gray-200 hover:border-gray-300'
                : 'border-gray-100 bg-gray-50 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  canUseWallet ? 'bg-orange-100' : 'bg-gray-100'
                }`}>
                  <i className={`ri-wallet-line text-xl ${canUseWallet ? 'text-orange-600' : 'text-gray-400'}`}></i>
                </div>
                <div className="text-left">
                  <div className={`font-semibold ${canUseWallet ? '' : 'text-gray-400'}`}>
                    J-Ride Wallet
                  </div>
                  <div className={`text-sm ${canUseWallet ? 'text-gray-600' : 'text-gray-400'}`}>
                    Balance: Ã¢â€šÂ±{walletBalance.toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-semibold ${canUseWallet ? 'text-orange-600' : 'text-gray-400'}`}>
                  Ã¢â€šÂ±{rideAmount.toFixed(2)}
                </div>
                {!canUseWallet && (
                  <div className="text-xs text-red-500">Insufficient balance</div>
                )}
              </div>
            </div>
          </button>

          {/* Reward Points */}
          <button
            onClick={() => setSelectedMethod('points')}
            disabled={!canUsePoints}
            className={`w-full p-4 rounded-xl border-2 transition-colors ${
              selectedMethod === 'points'
                ? 'border-purple-500 bg-purple-50'
                : canUsePoints
                ? 'border-gray-200 hover:border-gray-300'
                : 'border-gray-100 bg-gray-50 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  canUsePoints ? 'bg-purple-100' : 'bg-gray-100'
                }`}>
                  <i className={`ri-gift-line text-xl ${canUsePoints ? 'text-purple-600' : 'text-gray-400'}`}></i>
                </div>
                <div className="text-left">
                  <div className={`font-semibold ${canUsePoints ? '' : 'text-gray-400'}`}>
                    Reward Points
                  </div>
                  <div className={`text-sm ${canUsePoints ? 'text-gray-600' : 'text-gray-400'}`}>
                    Available: {rewardPoints} points
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-semibold ${canUsePoints ? 'text-purple-600' : 'text-gray-400'}`}>
                  {rideAmount * 10} pts
                </div>
                {!canUsePoints && (
                  <div className="text-xs text-red-500">Insufficient points</div>
                )}
              </div>
            </div>
          </button>
        </div>

        {/* Payment Method Comparison */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="text-sm font-medium text-gray-700 mb-3">Payment Method Comparison:</div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-green-600">Ã°Å¸â€™Â° Cash:</span>
              <span className="font-medium">Ã¢â€šÂ±{rideAmount.toFixed(2)} (No fees)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-blue-600">Ã°Å¸â€œÂ± GCash:</span>
              <span className="font-medium">Ã¢â€šÂ±{totalGCashCharge.toFixed(2)} (Includes fees)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-orange-600">Ã°Å¸â€™Â³ Wallet:</span>
              <span className="font-medium">Ã¢â€šÂ±{rideAmount.toFixed(2)} (No fees)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-purple-600">Ã°Å¸Å½Â Points:</span>
              <span className="font-medium">FREE ({rideAmount * 10} points)</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={handlePaymentConfirm}
            className="w-full bg-orange-500 text-white py-4 rounded-xl font-semibold hover:bg-orange-600 transition-colors"
          >
            {selectedMethod === 'cash' ? 'Confirm Cash Payment' :
             selectedMethod === 'gcash_xendit' ? 'Review GCash Payment' :
             selectedMethod === 'wallet' ? 'Pay with Wallet' :
             'Use Reward Points'}
          </button>
          
          <button
            onClick={onClose}
            className="w-full bg-gray-200 text-gray-800 py-3 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}





