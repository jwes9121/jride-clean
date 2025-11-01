
'use client';

import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: string;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    console.error('ErrorBoundary caught an error:', error);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary details:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });
    
    // Store additional error info
    this.setState({
      errorInfo: `${error.message} - Component: ${errorInfo.componentStack?.split('\n')[1]?.trim() || 'Unknown'}`
    });
  }

  handleRetry = () => {
    try {
      this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    } catch (error) {
      console.error('Error during retry:', error);
    }
  };

  handleRefresh = () => {
    try {
      if (typeof window !== 'undefined') {
        // Safe reload without overriding browser objects
        window.location.href = window.location.href;
      }
    } catch (error) {
      console.error('Error during refresh:', error);
    }
  };

  handleGoHome = () => {
    try {
      if (typeof window !== 'undefined') {
        // Safe navigation without overriding browser objects
        window.location.href = '/';
      }
    } catch (error) {
      console.error('Error during navigation:', error);
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 to-pink-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-6 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-error-warning-line text-2xl text-red-500"></i>
            </div>
            
            <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-gray-600 text-sm mb-6">
              We're fixing this error. Please try again or refresh the page.
            </p>

            {this.state.errorInfo && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-left">
                <p className="text-xs text-gray-500 font-mono break-words">
                  {this.state.errorInfo}
                </p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={this.handleRetry}
                className="w-full bg-blue-500 text-white py-3 rounded-xl font-semibold hover:bg-blue-600 transition-colors"
              >
                Try Again
              </button>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={this.handleRefresh}
                  className="bg-gray-100 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                >
                  Refresh Page
                </button>
                
                <button
                  onClick={this.handleGoHome}
                  className="bg-gray-100 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                >
                  Go Home
                </button>
              </div>
            </div>
            
            <p className="text-xs text-gray-400 mt-4">
              If the problem persists, please contact J-Ride support
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;


