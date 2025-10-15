'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Service {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  is_active: boolean;
  route: string;
  coming_soon?: boolean;
}

export default function ServicesMenu() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAvailableServices();
  }, []);

  const loadAvailableServices = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/multi-service-framework`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'get_available_services'
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setServices(result.services);
      }
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleComingSoonClick = (serviceName: string) => {
    alert(`${serviceName} will be available soon! Stay tuned for updates.`);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="bg-gray-200 rounded-xl h-32 animate-pulse"></div>
        ))}
      </div>
    );
  }

  const activeServices = services.filter(s => s.is_active);
  const comingSoonServices = services.filter(s => !s.is_active);

  return (
    <div className="space-y-6">
      {/* Active Services */}
      <div className="grid grid-cols-2 gap-4">
        {activeServices.map((service) => (
          <Link
            key={service.id}
            href={service.route}
            className="block group"
          >
            <div className="bg-white rounded-xl p-4 shadow-sm border-2 border-transparent group-hover:border-orange-200 group-hover:shadow-md transition-all duration-200">
              <div 
                className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                style={{ backgroundColor: `${service.color}20` }}
              >
                <i 
                  className={`${service.icon} text-xl`}
                  style={{ color: service.color }}
                ></i>
              </div>
              <h3 className="font-semibold text-gray-800 mb-1">{service.name}</h3>
              <p className="text-xs text-gray-600 leading-tight">{service.description}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Coming Soon Services */}
      {comingSoonServices.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <h3 className="font-semibold text-gray-700">Coming Soon</h3>
            <div className="flex-1 h-px bg-gray-200"></div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {comingSoonServices.map((service) => (
              <button
                key={service.id}
                onClick={() => handleComingSoonClick(service.name)}
                className="relative group"
              >
                <div className="bg-white rounded-xl p-4 shadow-sm border-2 border-gray-100 opacity-75 group-hover:opacity-90 transition-opacity">
                  <div 
                    className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                    style={{ backgroundColor: `${service.color}15` }}
                  >
                    <i 
                      className={`${service.icon} text-xl opacity-60`}
                      style={{ color: service.color }}
                    ></i>
                  </div>
                  <h3 className="font-semibold text-gray-600 mb-1">{service.name}</h3>
                  <p className="text-xs text-gray-500 leading-tight">{service.description}</p>
                  
                  {/* Coming Soon Badge */}
                  <div className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs px-2 py-1 rounded-full">
                    Soon
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Expansion Framework Message */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <i className="ri-roadmap-line text-blue-600"></i>
          </div>
          <div>
            <h4 className="font-semibold text-blue-900">Multi-Service Platform</h4>
            <p className="text-sm text-blue-700">J-Ride is expanding to serve all your transportation and delivery needs!</p>
          </div>
        </div>
        
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="bg-white/70 rounded-lg p-2">
            <i className="ri-check-line text-green-600 text-lg"></i>
            <p className="text-xs text-blue-800 mt-1">Ride Services</p>
          </div>
          <div className="bg-white/70 rounded-lg p-2">
            <i className="ri-time-line text-orange-600 text-lg"></i>
            <p className="text-xs text-blue-800 mt-1">Delivery Soon</p>
          </div>
          <div className="bg-white/70 rounded-lg p-2">
            <i className="ri-rocket-line text-blue-600 text-lg"></i>
            <p className="text-xs text-blue-800 mt-1">More Coming</p>
          </div>
        </div>
      </div>
    </div>
  );
}
