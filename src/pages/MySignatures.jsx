import React from 'react';
import Icon from '../components/common/Icon';
import SignaturesSettings from '../components/settings/SignaturesSettings';

/**
 * MySignatures — lightweight wrapper around the reusable <SignaturesSettings />
 * component so non-admin users (sales, procurement) can add/manage their own
 * approval signatures without being granted access to the full TaxSettings
 * admin screen. SignaturesSettings already filters by `createdBy === userId`
 * server-side, so each user only ever sees/edits their own signatures.
 *
 * Back button routes the user to whichever dashboard makes sense for their role;
 * when no sensible context is known we fall back to the sales dashboard (the
 * most common caller — see SalesInvoiceReview).
 */
const MySignatures = ({ navigateTo, userId, userEmail, currentUser }) => {
    const role = currentUser?.role;
    const backTarget =
        role === 'controller' || role === 'admin' ? 'controllerDashboard'
        : role === 'procurement' ? 'procurementDashboard'
        : 'salesDashboard';

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-5xl mx-auto p-4 md:p-8">
                <header className="bg-white p-4 rounded-xl shadow-md mb-6 flex justify-between items-center">
                    <div>
                        <button
                            onClick={() => navigateTo(backTarget)}
                            className="text-sm text-gray-600 hover:text-blue-600 mb-2"
                        >
                            <Icon id="arrow-left" className="mr-1" /> Back
                        </button>
                        <h1 className="text-2xl font-bold text-gray-800">My Signatures</h1>
                        <p className="text-sm text-gray-500 mt-1">
                            Capture or upload your approval signature. Only you can see and use your own signatures.
                        </p>
                    </div>
                    <div className="text-sm text-gray-600">
                        {userEmail}
                    </div>
                </header>

                <div className="bg-white rounded-xl shadow-md p-6">
                    <SignaturesSettings userId={userId} />
                </div>
            </div>
        </div>
    );
};

export default MySignatures;
