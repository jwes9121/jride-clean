'use client'

import { useEffect } from 'react'

interface QRScannerProps {
  isOpen: boolean
  onClose: () => void
  onScanResult: (result: string) => void
  expectedCode?: string // optional because selectedOrder can be null
}

export default function QRScanner({
  isOpen,
  onClose,
  onScanResult,
  expectedCode,
}: QRScannerProps) {
  useEffect(() => {
    if (!isOpen) return

    // Example mock scanner for demo / testing.
    // Replace with a real QR library integration (e.g. html5-qrcode, react-qr-scanner).
    const timer = setTimeout(() => {
      const fakeScan = '123456' // pretend this was scanned
      if (expectedCode && fakeScan === expectedCode) {
        onScanResult(fakeScan)
      } else {
        alert('Invalid pickup code')
      }
      onClose()
    }, 3000)

    return () => clearTimeout(timer)
  }, [isOpen, expectedCode, onClose, onScanResult])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-80 text-center">
        <h2 className="text-lg font-semibold mb-4">Scan Pickup Code</h2>
        <p className="text-gray-600 text-sm mb-4">
          Point your camera at the QR code provided by the vendor.
        </p>
        <div className="w-64 h-64 bg-gray-100 flex items-center justify-center mb-4">
          {/* Placeholder for scanner feed */}
          <span className="text-gray-400">[Camera Stream Here]</span>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}



