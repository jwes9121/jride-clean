'use client'

import { useState } from 'react'

interface PostTripSurveyModalProps {
  isOpen: boolean
  onClose: () => void
  tripData: {
    id: string
    type: 'delivery' | 'errand' | 'ride'
    vendor_name?: string
    driver_name?: string
    service_description: string
  }
  onSubmit: (surveyData: any) => void
}

export default function PostTripSurveyModal({
  isOpen,
  onClose,
  tripData,
  onSubmit
}: PostTripSurveyModalProps) {
  const [ratings, setRatings] = useState({
    item_accuracy: 0,
    timeliness: 0,
    communication: 0,
    overall: 0
  })
  const [feedback, setFeedback] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen) return null

  const handleStarClick = (category: string, rating: number) => {
    setRatings(prev => ({ ...prev, [category]: rating }))
  }

  const handleSubmit = async () => {
    if (ratings.overall === 0) return

    setIsSubmitting(true)
    
    const surveyData = {
      ratings,
      feedback,
      trip_id: tripData.id,
      trip_type: tripData.type
    }
    
    await onSubmit(surveyData)
    setIsSubmitting(false)
    onClose()
  }

  const StarRating = ({ category, value, onChange }: { category: string, value: number, onChange: (rating: number) => void }) => (
    <div className="flex items-center space-x-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(star)}
          className={`w-8 h-8 ${star <= value ? 'text-yellow-400' : 'text-gray-300'} hover:text-yellow-400 transition-colors`}
        >
          <i className="ri-star-fill"></i>
        </button>
      ))}
    </div>
  )

  const getSurveyQuestions = () => {
    if (tripData.type === 'delivery') {
      return [
        { key: 'item_accuracy', label: 'Item Accuracy', desc: 'Were all items correct and complete?' },
        { key: 'timeliness', label: 'Timeliness', desc: 'Was the delivery completed on time?' },
        { key: 'communication', label: 'Service Quality', desc: 'How was the overall service quality?' }
      ]
    } else if (tripData.type === 'errand') {
      return [
        { key: 'item_accuracy', label: 'Task Completion', desc: 'Was the errand completed as requested?' },
        { key: 'timeliness', label: 'Timeliness', desc: 'Was the errand completed on time?' },
        { key: 'communication', label: 'Communication', desc: 'How was the driver communication?' }
      ]
    } else {
      return [
        { key: 'item_accuracy', label: 'Route Efficiency', desc: 'Was the route taken efficient?' },
        { key: 'timeliness', label: 'Timeliness', desc: 'Was the ride completed on time?' },
        { key: 'communication', label: 'Driver Behavior', desc: 'How was the driver behavior?' }
      ]
    }
  }

  const surveyQuestions = getSurveyQuestions()

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md mx-auto max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="ri-star-line text-2xl text-blue-600"></i>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Rate Your Experience</h2>
          <p className="text-sm text-gray-600">Help us improve our service</p>
        </div>

        {/* Service Info */}
        <div className="bg-gray-50 rounded-2xl p-4 mb-6">
          <div className="text-center">
            <h3 className="font-medium text-gray-900 mb-1">{tripData.service_description}</h3>
            {tripData.vendor_name && (
              <p className="text-sm text-gray-600">Vendor: {tripData.vendor_name}</p>
            )}
            {tripData.driver_name && (
              <p className="text-sm text-gray-600">Driver: {tripData.driver_name}</p>
            )}
          </div>
        </div>

        {/* Rating Questions */}
        <div className="space-y-4 mb-6">
          {surveyQuestions.map((question) => (
            <div key={question.key} className="space-y-2">
              <div>
                <h4 className="font-medium text-gray-900">{question.label}</h4>
                <p className="text-sm text-gray-600">{question.desc}</p>
              </div>
              <StarRating
                category={question.key}
                value={ratings[question.key]}
                onChange={(rating) => handleStarClick(question.key, rating)}
              />
            </div>
          ))}
        </div>

        {/* Overall Rating */}
        <div className="space-y-2 mb-6">
          <div>
            <h4 className="font-medium text-gray-900">Overall Experience</h4>
            <p className="text-sm text-gray-600">How would you rate this service overall?</p>
          </div>
          <StarRating
            category="overall"
            value={ratings.overall}
            onChange={(rating) => handleStarClick('overall', rating)}
          />
        </div>

        {/* Feedback */}
        <div className="mb-6">
          <label className="block font-medium text-gray-900 mb-2">
            Additional Feedback (Optional)
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            placeholder="Share your thoughts about the service..."
          />
        </div>

        {/* Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleSubmit}
            disabled={ratings.overall === 0 || isSubmitting}
            className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-2xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <>
                <i className="ri-star-line mr-2"></i>
                Submit Rating
              </>
            )}
          </button>
          
          <button
            onClick={onClose}
            className="w-full py-3 bg-gray-100 text-gray-700 rounded-2xl font-medium hover:bg-gray-200 transition-colors"
          >
            Skip for Now
          </button>
        </div>

        {/* Privacy Notice */}
        <div className="mt-4 p-3 bg-blue-50 rounded-xl">
          <div className="flex items-start">
            <i className="ri-shield-check-line text-blue-600 mt-0.5 mr-2 flex-shrink-0"></i>
            <div className="text-xs text-blue-800">
              <p className="font-medium mb-1">Quality Assurance:</p>
              <p>Your feedback helps maintain service quality. Low ratings are reviewed by our dispatch team for service improvement.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
