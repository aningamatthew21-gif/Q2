import React from 'react';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
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
        <>
            <PageHeader
                title="My Signatures"
                subtitle="Capture or upload your approval signature. Only you can see and use your own signatures."
                back={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo(backTarget)} leftIcon={<Icon id="arrow-left" />}>
                        Back
                    </Button>
                }
                actions={<div className="text-sm text-ink-muted">{userEmail}</div>}
            />

            <div className="bg-surface rounded-panel shadow-card border border-line p-6">
                <SignaturesSettings userId={userId} />
            </div>
        </>
    );
};

export default MySignatures;
