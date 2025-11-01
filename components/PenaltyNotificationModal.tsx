'use client'

interface PenaltyNotificationModalProps {
  isOpen: boolean
  onClose: () => void
  penalty: {
    type: 'warning' | 'deduction' | 'suspension' | 'reward'
    title: string
    message: string
    amount?: number
    duration?: string
    offenseCount?: number
  }
}

export default function PenaltyNotificationModal({
  isOpen,
  onClose,
  penalty
}: PenaltyNotificationModalProps) {
  if (!isOpen) return null

  const getIconAndColor = () => {
    switch (penalty.type) {
      case 'warning':
        return { icon: 'ri-alert-line', bg: 'bg-yellow-100', text: 'text-yellow-800', accent: 'text-yellow-600' }
      case 'deduction':
        return { icon: 'ri-funds-line', bg: 'bg-red-100', text: 'text-red-800', accent: 'text-red-600' }
      case 'suspension':
        return { icon: 'ri-forbid-line', bg: 'bg-red-100', text: 'text-red-800', accent: 'text-red-600' }
      case 'reward':
        return { icon: 'ri-trophy-line', bg: 'bg-green-100', text: 'text-green-800', accent: 'text-green-600' }
      default:
        return { icon: 'ri-information-line', bg: 'bg-blue-100', text: 'text-blue-800', accent: 'text-blue-600' }
    }
  }

  const style = getIconAndColor()

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className={`w-16 h-16 ${style.bg} rounded-full flex items-center justify-center mx-auto mb-4`}>
            <i className={`${style.icon} text-2xl ${style.accent}`}></i>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">{penalty.title}</h2>
        </div>

        {/* Message */}
        <div className={`${style.bg} rounded-2xl p-4 mb-6`}>
          <p className={`${style.text} text-sm leading-relaxed`}>
            {penalty.message}
          </p>
          
          {penalty.amount && (
            <div className="mt-3 pt-3 border-t border-current border-opacity-20">
              <div className="flex justify-between items-center">
                <span className={`font-medium ${style.text}`}>
                  {penalty.type === 'reward' ? 'Bonus Amount:' : 'Penalty Amount:'}
                </span>
                <span className={`font-bold text-lg ${style.accent}`}>
                  â‚±{penalty.amount.toFixed(2)}
                </span>
              </div>
            </div>
          )}
          
          {penalty.duration && (
            <div className="mt-2">
              <div className="flex justify-between items-center">
                <span className={`font-medium ${style.text}`}>Duration:</span>
                <span className={`font-bold ${style.accent}`}>{penalty.duration}</span>
              </div>
            </div>
          )}
          
          {penalty.offenseCount && penalty.type !== 'reward' && (
            <div className="mt-2">
              <div className="flex justify-between items-center">
                <span className={`font-medium ${style.text}`}>Offense Count:</span>
                <span className={`font-bold ${style.accent}`}>{penalty.offenseCount}</span>
              </div>
            </div>
          )}
        </div>

        {/* Guidance */}
        {penalty.type === 'warning' && (
          <div className="bg-blue-50 rounded-xl p-3 mb-4">
            <div className="flex items-start">
              <i className="ri-lightbulb-line text-blue-600 mt-0.5 mr-2 flex-shrink-0"></i>
              <div className="text-xs text-blue-800">
                <p className="font-medium mb-1">Avoid Future Penalties:</p>
                <p>â€¢ Respond to order confirmations within 3 minutes</p>
                <p>â€¢ Maintain honest passenger count declarations</p>
                <p>â€¢ Follow all service guidelines</p>
              </div>
            </div>
          </div>
        )}

        {penalty.type === 'deduction' && (
          <div className="bg-orange-50 rounded-xl p-3 mb-4">
            <div className="flex items-start">
              <i className="ri-wallet-line text-orange-600 mt-0.5 mr-2 flex-shrink-0"></i>
              <div className="text-xs text-orange-800">
                <p className="font-medium mb-1">Payment Deduction:</p>
                <p>Amount deducted from wallet â†’ points â†’ next top-up. Continue following guidelines to avoid suspension.</p>
              </div>
            </div>
          </div>
        )}

        {penalty.type === 'suspension' && (
          <div className="bg-red-50 rounded-xl p-3 mb-4">
            <div className="flex items-start">
              <i className="ri-pause-circle-line text-red-600 mt-0.5 mr-2 flex-shrink-0"></i>
              <div className="text-xs text-red-800">
                <p className="font-medium mb-1">Account Suspended:</p>
                <p>Your account access is temporarily restricted. Review our guidelines and contact support if needed.</p>
              </div>
            </div>
          </div>
        )}

        {penalty.type === 'reward' && (
          <div className="bg-green-50 rounded-xl p-3 mb-4">
            <div className="flex items-start">
              <i className="ri-medal-line text-green-600 mt-0.5 mr-2 flex-shrink-0"></i>
              <div className="text-xs text-green-800">
                <p className="font-medium mb-1">Trusted Partner Reward:</p>
                <p>Thank you for maintaining excellent service standards! Keep up the great work.</p>
              </div>
            </div>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={onClose}
          className={`w-full py-3 ${
            penalty.type === 'reward' ? 'bg-green-600 hover:bg-green-700' :
            penalty.type === 'warning' ? 'bg-yellow-600 hover:bg-yellow-700' :
            'bg-gray-600 hover:bg-gray-700'
          } text-white rounded-2xl font-medium transition-colors`}
        >
          {penalty.type === 'reward' ? 'Celebrate!' : 'I Understand'}
        </button>

        {/* Footer */}
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">
            For questions, contact our support team
          </p>
        </div>
      </div>
    </div>
  )
}



