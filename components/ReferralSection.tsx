
'use client';

import { useState, useEffect } from 'react';

interface ReferralStats {
  totalReferrals: number;
  completedReferrals: number;
  pendingReferrals: number;
  totalPoints: number;
  referralCode: string | null;
  referralLink: string | null;
  recentReferrals: any[];
}

export default function ReferralSection() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadReferralStats();
  }, []);

  const loadReferralStats = async () => {
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
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error loading referral stats:', error);
    }
    setLoading(false);
  };

  const generateReferralCode = async () => {
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
          action: 'generate_referral_code',
          userId: user.id
        })
      });

      const data = await response.json();
      if (data.success) {
        await loadReferralStats(); // Reload stats
      }
    } catch (error) {
      console.error('Error generating referral code:', error);
    }
  };

  const copyReferralLink = async () => {
    if (stats?.referralLink) {
      try {
        await navigator.clipboard.writeText(stats.referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Error copying to clipboard:', error);
      }
    }
  };

  const shareReferralCode = async () => {
    if (stats?.referralCode && stats?.referralLink) {
      const shareText = `Join J-Ride using my referral code: ${stats.referralCode}\n\nNew passengers get ₱30 free ride credit!\nI get 15 points (₱15 ride credit) when you complete your first ride.\n\nSign up here: ${stats.referralLink}`;
      
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Join J-Ride',
            text: shareText
          });
        } catch (error) {
          console.log('Error sharing:', error);
        }
      } else {
        // Fallback to copying text
        try {
          await navigator.clipboard.writeText(shareText);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (error) {
          console.error('Error copying to clipboard:', error);
        }
      }
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-4">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div className="h-8 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border">
      <div className="p-4 border-b">
        <h3 className="font-semibold flex items-center">
          <i className="ri-user-add-line text-purple-600 mr-2"></i>
          Refer Friends & Earn Points
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Refer new passengers and earn 15 points (₱15 ride credit) each
        </p>
      </div>

      <div className="p-4">
        {!stats?.referralCode ? (
          <div className="text-center py-6">
            <i className="ri-gift-line text-4xl text-purple-500 mb-4"></i>
            <p className="text-gray-600 mb-4">Generate your referral code to start earning!</p>
            <button 
              onClick={generateReferralCode}
              className="bg-purple-500 text-white px-6 py-2 rounded-lg font-medium"
            >
              Generate Referral Code
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-purple-50 p-3 rounded-xl text-center">
                <div className="text-lg font-bold text-purple-700">{stats.totalReferrals}</div>
                <div className="text-xs text-purple-600">Total Referrals</div>
              </div>
              <div className="bg-green-50 p-3 rounded-xl text-center">
                <div className="text-lg font-bold text-green-700">{stats.completedReferrals}</div>
                <div className="text-xs text-green-600">Completed</div>
              </div>
              <div className="bg-orange-50 p-3 rounded-xl text-center">
                <div className="text-lg font-bold text-orange-700">{stats.totalPoints}</div>
                <div className="text-xs text-orange-600">Points Earned</div>
              </div>
            </div>

            {/* Referral Code */}
            <div className="bg-gray-50 p-4 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Your Referral Code</span>
                <button 
                  onClick={() => setShowCode(!showCode)}
                  className="text-xs text-purple-600"
                >
                  {showCode ? 'Hide' : 'Show'}
                </button>
              </div>
              {showCode && (
                <div className="bg-white p-3 rounded-lg border-2 border-dashed border-purple-200 text-center">
                  <div className="text-2xl font-bold text-purple-600 mb-2">{stats.referralCode}</div>
                  <button 
                    onClick={copyReferralLink}
                    className="text-sm text-purple-600 bg-purple-100 px-3 py-1 rounded-full"
                  >
                    {copied ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={shareReferralCode}
                className="bg-purple-500 text-white p-3 rounded-lg font-medium flex items-center justify-center"
              >
                <i className="ri-share-line mr-2"></i>
                Share Code
              </button>
              <button 
                onClick={copyReferralLink}
                className="bg-purple-100 text-purple-600 p-3 rounded-lg font-medium flex items-center justify-center"
              >
                <i className="ri-clipboard-line mr-2"></i>
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>

            {/* How it Works */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
              <h4 className="font-medium text-blue-800 mb-2">How Referrals Work:</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• New passengers get ₱30 free ride credit (valid 7 days)</li>
                <li>• You earn 15 points when they complete their first ride</li>
                <li>• 1 point = ₱1 ride credit (auto-applied at checkout)</li>
                <li>• {JSON.parse(localStorage.getItem('j-ride-user') || '{}').user_type === 'driver' ? 'Drivers can only refer passengers' : 'Passengers can refer other passengers'}</li>
              </ul>
            </div>

            {/* Recent Referrals */}
            {stats.recentReferrals.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Recent Referrals</h4>
                <div className="space-y-2">
                  {stats.recentReferrals.map((referral: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <div>
                        <div className="text-sm font-medium">{referral.referred_name}</div>
                        <div className="text-xs text-gray-600">
                          {new Date(referral.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className={`text-xs px-2 py-1 rounded-full ${
                        referral.status === 'completed' 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {referral.status === 'completed' ? '+15 points' : 'Pending'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
