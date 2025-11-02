
'use client';

import { useState, useEffect } from 'react';

interface MembershipTier {
  tier: 'Bronze' | 'Silver' | 'Gold';
  minRides: number;
  minTopUps: number;
  priorityMatching: boolean;
  discountPercentage: number;
  bonusPointsMultiplier: number;
  perks: string[];
  color: string;
}

interface MembershipCardProps {
  userId: string;
}

export default function MembershipCard({ userId }: MembershipCardProps) {
  const [currentTier, setCurrentTier] = useState<MembershipTier | null>(null);
  const [nextTier, setNextTier] = useState<MembershipTier | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [resetInfo, setResetInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showPerks, setShowPerks] = useState(false);

  useEffect(() => {
    loadMembershipStatus();
  }, [userId]);

  const loadMembershipStatus = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/loyalty-membership-system`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'calculate_membership_tier',
          userId: userId
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setCurrentTier(result.currentTier);
        setNextTier(result.nextTier);
        setProgress(result.progress);
        setStats(result.stats);
        setResetInfo(result.resetInfo);
      }
    } catch (error) {
      console.error('Error loading membership:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'Gold': return 'ri-vip-crown-fill';
      case 'Silver': return 'ri-medal-line';
      case 'Bronze': return 'ri-award-line';
      default: return 'ri-user-line';
    }
  };

  const getTierGradient = (tier: string) => {
    switch (tier) {
      case 'Gold': return 'from-yellow-400 to-yellow-600';
      case 'Silver': return 'from-gray-300 to-gray-500';
      case 'Bronze': return 'from-orange-400 to-orange-600';
      default: return 'from-gray-400 to-gray-600';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getDaysUntilReset = () => {
    if (!resetInfo?.nextReset) return 0;
    const nextReset = new Date(resetInfo.nextReset);
    const now = new Date();
    const diffTime = nextReset.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm animate-pulse">
        <div className="h-6 bg-gray-200 rounded mb-4"></div>
        <div className="h-4 bg-gray-200 rounded mb-2"></div>
        <div className="h-4 bg-gray-200 rounded"></div>
      </div>
    );
  }

  if (!currentTier) return null;

  return (
    <div className={`bg-gradient-to-br ${getTierGradient(currentTier.tier)} rounded-xl p-6 text-white shadow-lg`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
            <i className={`${getTierIcon(currentTier.tier)} text-2xl text-white`}></i>
          </div>
          <div>
            <h3 className="text-xl font-bold">{currentTier.tier} Member</h3>
            <p className="text-white/80 text-sm">Current Cycle Status</p>
          </div>
        </div>
        <button 
          onClick={() => setShowPerks(!showPerks)}
          className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-all duration-200"
        >
          <i className={`ri-information-line text-lg ${showPerks ? 'rotate-180' : ''} transition-transform duration-200`}></i>
        </button>
      </div>

      {/* Reset Cycle Info */}
      {resetInfo && (
        <div className="bg-white/10 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-white/80">Current Cycle ({resetInfo.resetCycle} months)</span>
            <span className="text-white font-medium">{getDaysUntilReset()} days left</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/70">Started: {formatDate(resetInfo.cycleStart)}</span>
            <span className="text-white/70">Resets: {formatDate(resetInfo.nextReset)}</span>
          </div>
        </div>
      )}

      {/* Benefits Summary */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <p className="text-2xl font-bold">{currentTier.discountPercentage}%</p>
          <p className="text-xs text-white/80">Discount</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold">{currentTier.bonusPointsMultiplier}x</p>
          <p className="text-xs text-white/80">Points</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold">{currentTier.priorityMatching ? 'Yes' : 'No'}</p>
          <p className="text-xs text-white/80">Priority</p>
        </div>
      </div>

      {/* Current Cycle Progress */}
      <div className="bg-white/10 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">This Cycle Progress</span>
          <span className="text-xs text-white/80">
            Rides: {stats?.currentCycleRides || 0} | Top-ups: {stats?.currentCycleTopUps || 0}
          </span>
        </div>
        
        {nextTier && progress && (
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Rides: {stats.currentCycleRides}/{nextTier.minRides}</span>
                <span>{progress.ridesNeeded} more needed</span>
              </div>
              <div className="bg-white/20 rounded-full h-2">
                <div 
                  className="bg-white rounded-full h-2 transition-all duration-500"
                  style={{ width: `${Math.min(progress.ridesProgress, 100)}%` }}
                ></div>
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Top-ups: {stats.currentCycleTopUps}/{nextTier.minTopUps}</span>
                <span>{progress.topUpsNeeded} more needed</span>
              </div>
              <div className="bg-white/20 rounded-full h-2">
                <div 
                  className="bg-white rounded-full h-2 transition-all duration-500"
                  style={{ width: `${Math.min(progress.topUpsProgress, 100)}%` }}
                ></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Perks Expanded */}
      {showPerks && (
        <div className="bg-white/10 rounded-lg p-4 space-y-2">
          <h4 className="font-semibold text-sm mb-2">Your {currentTier.tier} Benefits:</h4>
          {currentTier.perks.map((perk, index) => (
            <div key={index} className="flex items-start space-x-2">
              <i className="ri-check-line text-sm mt-0.5 text-white/80"></i>
              <span className="text-xs text-white/90">{perk}</span>
            </div>
          ))}
          <div className="border-t border-white/20 pt-2 mt-2">
            <p className="text-xs text-white/70">
              Tiers reset every {resetInfo?.resetCycle || 3} months to maintain active engagement
            </p>
          </div>
        </div>
      )}

      {!nextTier && (
        <div className="bg-white/10 rounded-lg p-4 text-center">
          <i className="ri-trophy-fill text-3xl text-white/60 mb-2"></i>
          <p className="text-sm font-semibold">Maximum Tier Achieved!</p>
          <p className="text-xs text-white/80">You're enjoying all premium benefits this cycle</p>
        </div>
      )}
    </div>
  );
}



