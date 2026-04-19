import React from 'react';
import { AppProvider } from './context/AppContext';
import ErrorBoundary from './components/common/ErrorBoundary';

function App() {
    return (
        <ErrorBoundary>
            <AppProvider />
        </ErrorBoundary>
    );
}

export default App;
