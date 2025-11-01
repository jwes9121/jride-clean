'use client'

import { useState } from 'react'
import { Booking } from '@/types/booking'

export default function BookingForm({
  onBookingCreated,
}: {
  onBookingCreated?: (booking: Booking) => void
}) {
  const [customerName, setCustomerName] = useState('')
  const [pickupLocation, setPickupLocation] = useState('')
  const [dropoffLocation, setDropoffLocation] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = localStorage.getItem('j-ride-token')

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/booking-service`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: 'create_booking',
            customer_name: customerName,
            pickup_location: pickupLocation,
            dropoff_location: dropoffLocation,
          }),
        }
      )

      const data = await response.json()

      if (data.success && data.booking) {
        const newBooking: Booking = data.booking
        if (onBookingCreated) {
          onBookingCreated(newBooking)
        }

        setCustomerName('')
        setPickupLocation('')
        setDropoffLocation('')
        alert('Booking created successfully!')
      } else {
        alert(data.message || 'Failed to create booking')
      }
    } catch (error) {
      console.error('Error creating booking:', error)
      alert('Error creating booking')
    }

    setLoading(false)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-4 rounded-lg shadow-md border space-y-3"
    >
      <h2 className="text-xl font-bold mb-2">New Booking</h2>

      <input
        type="text"
        placeholder="Customer Name"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        className="w-full p-2 border rounded"
        required
      />

      <input
        type="text"
        placeholder="Pickup Location"
        value={pickupLocation}
        onChange={(e) => setPickupLocation(e.target.value)}
        className="w-full p-2 border rounded"
        required
      />

      <input
        type="text"
        placeholder="Dropoff Location"
        value={dropoffLocation}
        onChange={(e) => setDropoffLocation(e.target.value)}
        className="w-full p-2 border rounded"
        required
      />

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
      >
        {loading ? 'Creating...' : 'Create Booking'}
      </button>
    </form>
  )
}


