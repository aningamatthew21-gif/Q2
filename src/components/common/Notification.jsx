import React, { useEffect } from 'react';

const Notification = ({ message, onDismiss, type = 'error' }) => {
    const colors = {
        error: 'bg-red-600',
        success: 'bg-green-600'
    };
    useEffect(() => { const timer = setTimeout(() => { onDismiss(); }, 4000); return () => clearTimeout(timer); }, [onDismiss]);
    return (<div className={`fixed top-20 left-1/2 -translate-x-1/2 ${colors[type]} text-white py-2 px-4 rounded-md shadow-lg z-50`}>{message}</div>);
};

export default Notification;
