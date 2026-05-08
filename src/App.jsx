import React from 'react';
import { AppProvider } from './context/AppContext';
import { UIPreferencesProvider } from './context/UIPreferencesContext';
import { PromptProvider } from './components/v2/PromptDialog';
import ErrorBoundary from './components/common/ErrorBoundary';

/**
 * App root.
 *
 * Provider order matters:
 *   ErrorBoundary  > UIPreferences > Prompt > AppProvider
 *
 * UIPreferences is outermost (after ErrorBoundary) so theme/sound/haptics
 * settings are visible to every descendant. PromptProvider mounts a single
 * <Dialog> overlay that any descendant can drive via usePrompt(); putting
 * it above AppProvider lets login + customerPortal (chromeless pages) use
 * the same custom Reason / Confirm modal — no more native browser prompts.
 */
function App() {
    return (
        <ErrorBoundary>
            <UIPreferencesProvider>
                <PromptProvider>
                    <AppProvider />
                </PromptProvider>
            </UIPreferencesProvider>
        </ErrorBoundary>
    );
}

export default App;
