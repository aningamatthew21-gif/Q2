import React from 'react';
import { AppProvider } from './context/AppContext';
import { UIPreferencesProvider } from './context/UIPreferencesContext';
import ErrorBoundary from './components/common/ErrorBoundary';

function App() {
    return (
        <ErrorBoundary>
            <UIPreferencesProvider>
                <AppProvider />
            </UIPreferencesProvider>
        </ErrorBoundary>
    );
}

export default App;
