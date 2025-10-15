
'use client';

import Link from 'next/link';

export default function QuickActions() {
  const actions = [
    {
      id: 'ride',
      title: 'Book Ride',
      icon: 'ri-truck-line',
      color: 'bg-blue-500',
      href: '/ride'
    },
    {
      id: 'food',
      title: 'Order Food',
      icon: 'ri-restaurant-line',
      color: 'bg-orange-500',
      href: '/delivery'
    },
    {
      id: 'topup',
      title: 'Top Up',
      icon: 'ri-add-circle-line',
      color: 'bg-green-500',
      href: '/wallet/topup'
    },
    {
      id: 'history',
      title: 'History',
      icon: 'ri-history-line',
      color: 'bg-gray-500',
      href: '/history'
    }
  ];

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border">
      <h2 className="font-bold text-gray-900 mb-4">Quick Actions</h2>
      
      <div className="grid grid-cols-2 gap-4">
        {actions.map((action) => (
          <Link key={action.id} href={action.href}>
            <button className="w-full p-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors group">
              <div className="flex flex-col items-center space-y-2">
                <div className={`w-12 h-12 ${action.color} rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform`}>
                  <i className={`${action.icon} text-xl text-white`}></i>
                </div>
                <span className="text-sm font-medium text-gray-700">{action.title}</span>
              </div>
            </button>
          </Link>
        ))}
      </div>
    </div>
  );
}
