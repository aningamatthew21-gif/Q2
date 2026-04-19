import React from 'react';
import { logActivity } from '../../utils/logger';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Uncaught error:", error, errorInfo);

        const { userId, userEmail } = this.props;
        const username = userEmail || userId || 'Anonymous';

        logActivity(username, 'CLIENT_ERROR', error.message, {
            error: error.toString(),
            stack: errorInfo.componentStack,
            userAgent: navigator.userAgent,
            url: window.location.href
        }).catch(console.error);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-100">
                    <div className="bg-white p-8 rounded-xl shadow-md max-w-md w-full text-center">
                        <h2 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h2>
                        <p className="text-gray-600 mb-6">We're sorry, but an unexpected error occurred. Our team has been notified.</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700"
                        >
                            Reload Application
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
