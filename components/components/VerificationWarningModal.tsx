'use client'

import React from 'react'

interface VerificationWarningModalProps {
  isOpen: boolean
  onClose: () => void
  onProceed: () => void
  verificationType: 'unverified' | 'night_restriction'
}

const VerificationWarningModal: React.FC<VerificationWarningModalProps> = ({ 
  isOpen, 
  onClose, 
  onProceed, 
  verificationType 
}) => {
  if (!isOpen) return null

  const getWarningContent = () => {
    if (verificationType === 'night_restriction') {
      return {
        title: 'Night Booking Restriction',
        icon: 'ri-moon-line',
        iconColor: 'text-orange-600',
        bgColor: 'bg-orange-100',
        message: 'Unverified users cannot book rides between 7:00 PM - 5:00 AM for safety reasons.',
        restrictions: [
          'This restriction applies from 7:00 PM to 5:00 AM daily',
          'Complete your ID verification to remove this restriction',
          'You can book rides normally during daytime hours'
        ],
        actionText: 'Complete Verification',
        proceedText: 'Book During Day Hours'
      }
    } else {
      return {
        title: 'Unverified Account',
        icon: 'ri-shield-line',
        iconColor: 'text-red-600',
        bgColor: 'bg-red-100',
        message: 'Your account is not yet verified. You can still book rides but with some restrictions.',
        restrictions: [
          'No access to promotional discounts',
          'No referral rewards or loyalty points',
          'Rides may be cancelled during night hours (7PM-5AM)',
          'Limited customer support priority'
        ],
        actionText: 'Complete Verification',
        proceedText: 'Book Anyway'
      }
    }
  }

  const content = getWarningContent()

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <div className="text-center mb-6">
          <div className={`w-16 h-16 ${content.bgColor} rounded-full flex items-center justify-center mx-auto mb-4`}>
            <i className={`${content.icon} text-2xl ${content.iconColor}`}></i>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">{content.title}</h2>
          <p className="text-sm text-gray-600">{content.message}</p>
        </div>

        <div className="mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">Current Restrictions:</h3>
          <ul className="space-y-2">
            {content.restrictions.map((restriction, index) => (
              <li key={index} className="flex items-start space-x-2 text-sm text-gray-600">
                <i className="ri-close-circle-line text-red-500 mt-0.5 flex-shrink-0"></i>
                <span>{restriction}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => {
              onClose()
              // Navigate to verification page or show verification modal
              // This would be implemented based on your app structure
            }}
            className="w-full bg-teal-600 text-white py-3 rounded-xl font-semibold hover:bg-teal-700"
          >
            {content.actionText}
          </button>

          <button
            onClick={() => {
              onProceed()
              onClose()
            }}
            className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-200"
          >
            {content.proceedText}
          </button>

          <button
            onClick={onClose}
            className="w-full text-gray-500 py-2 text-sm hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default VerificationWarningModal



