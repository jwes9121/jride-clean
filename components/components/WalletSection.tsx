
'use client';

import { useState } from 'react';
import Link from 'next/link';

interface WalletSectionProps {
  walletBalance?: number;
  rewardPoints?: number;
}

export default function WalletSection({ walletBalance = 0, rewardPoints = 0 }: WalletSectionProps) {
  const [showPointsInfo, setShowPointsInfo] = useState(false);

  // Ensure values are numbers and handle undefined/null cases
  const safeWalletBalance = typeof walletBalance === 'number' ? walletBalance : 0;
  const safeRewardPoints = typeof rewardPoints === 'number' ? rewardPoints : 0;
  const pointsValue = safeRewardPoints; // 1 point = â‚±1

  return (
    <div className="bg-gradient-to-br from-orange-400 to-green-400 rounded-2xl p-6 text-white relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-4 right-4 w-20 h-20 border-2 border-white rounded-full"></div>
        <div className="absolute bottom-4 left-4 w-16 h-16 border-2 border-white rounded-full"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-32 h-32 border border-white rounded-full"></div>
      </div>

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold opacity-90">J-Ride Wallet</h3>
            <div className="flex items-baseline space-x-1">
              <span className="text-3xl font-bold">â‚±{safeWalletBalance.toFixed(2)}</span>
            </div>
          </div>
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
            <i className="ri-wallet-line text-2xl"></i>
          </div>
        </div>

        {/* Reward Points Section */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <i className="ri-gift-line text-yellow-200"></i>
              <span className="font-semibold">Reward Points</span>
              <button
                onClick={() => setShowPointsInfo(!showPointsInfo)}
                className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center"
              >
                <i className="ri-information-line text-xs"></i>
              </button>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold">{safeRewardPoints}</div>
              <div className="text-xs opacity-80">â‰ˆ â‚±{pointsValue.toFixed(2)} credit</div>
            </div>
          </div>

          {showPointsInfo && (
            <div className="bg-white/10 rounded-lg p-3 mt-3">
              <h4 className="font-semibold text-sm mb-2">How Reward Points Work:</h4>
              <ul className="text-xs space-y-1 opacity-90">
                <li>â€¢ Earn 1 point per â‚±30 spent</li>
                <li>â€¢ 1 point = â‚±1 ride credit</li>
                <li>â€¢ Use points for free rides when balance is equal or more than fare</li>
                <li>â€¢ Redeem only if points â‰¥ full fare amount</li>
                <li>â€¢ No partial payments allowed</li>
              </ul>
            </div>
          )}

          {safeRewardPoints >= 30 && (
            <div className="mt-3 bg-yellow-400/20 border border-yellow-400/30 rounded-lg p-2">
              <div className="flex items-center space-x-2">
                <i className="ri-gift-fill text-yellow-200"></i>
                <span className="text-sm font-medium">You can get FREE rides!</span>
              </div>
              <p className="text-xs opacity-80 mt-1">
                Use {Math.floor(safeRewardPoints / 30)} Ã— â‚±30 trips with points
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Link href="/wallet/topup">
            <button className="bg-white/10 backdrop-blur-sm p-3 rounded-xl text-center hover:bg-white/20 transition-colors">
              <i className="ri-add-circle-line text-xl mb-1 block"></i>
              <span className="text-sm font-medium">Top Up</span>
            </button>
          </Link>

          <Link href="/wallet">
            <button className="bg-white/10 backdrop-blur-sm p-3 rounded-xl text-center hover:bg-white/20 transition-colors">
              <i className="ri-history-line text-xl mb-1 block"></i>
              <span className="text-sm font-medium">History</span>
            </button>
          </Link>

          <Link href="/wallet/cashout">
            <button className="bg-white/10 backdrop-blur-sm p-3 rounded-xl text-center hover:bg-white/20 transition-colors">
              <i className="ri-money-dollar-circle-line text-xl mb-1 block"></i>
              <span className="text-sm font-medium">Pay in Cash</span>
            </button>
          </Link>
        </div>

        {/* Points Breakdown */}
        {safeRewardPoints > 0 && (
          <div className="mt-4 bg-white/5 rounded-lg p-3">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-bold">{Math.floor(safeRewardPoints / 30)}</div>
                <div className="text-xs opacity-80">â‚±30 Trips</div>
              </div>
              <div>
                <div className="text-lg font-bold">{Math.floor((safeRewardPoints % 30) / 15)}</div>
                <div className="text-xs opacity-80">â‚±15 Trips</div>
              </div>
              <div>
                <div className="text-lg font-bold">{safeRewardPoints % 15}</div>
                <div className="text-xs opacity-80">Extra Points</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


