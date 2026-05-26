import React, { useState } from 'react';
import PageHeader from '../../components/common/PageHeader';
import Button from '../../components/common/Button';
import Icon from '../../components/common/Icon';
import Card, { CardHead, CardBody } from '../../components/v2/Card';
import ExportFormatModal from '../../components/modals/ExportFormatModal';
import { useApp } from '../../context/AppContext';

/**
 * ReportPage — shared chrome for every Module 5 report.
 *
 * Owns: PageHeader (with back-to-hub button), filter bar slot, KPI band,
 * chart slot, table slot, loading / empty / error states, and the
 * Export button → ExportFormatModal (PDF / XLSX / both-ZIP).
 *
 * Reports plug their content into the slots. The wrapper is 100% layout
 * — no data fetching, no SQL knowledge, no per-report logic.
 *
 *   <ReportPage
 *     title="AR Aging"
 *     subtitle="As of 2026-05-24"
 *     loading={loading}
 *     error={error}
 *     empty={!rows.length}
 *     onExport={(format) => exportArAging(format, rows)}
 *     filters={<MyFilters .../>}
 *     kpiBand={<MetricTile .../>}    // typically a row of 4
 *     charts={<ChartCard><BarChart .../></ChartCard>}
 *   >
 *     <DataTable rows={rows} columns={columns} />
 *   </ReportPage>
 */
const ReportPage = ({
    title,
    subtitle,
    icon,             // optional Icon id for the header
    loading = false,
    error = null,
    empty = false,
    emptyHint = 'No data to display for the selected filters.',
    onExport,         // (format: 'pdf'|'xlsx'|'zip') => Promise
    filters,          // JSX
    kpiBand,          // JSX (typically a row of 4 MetricTile)
    charts,           // JSX (typically 1-2 ChartCard)
    children          // detail table
}) => {
    const { navigate } = useApp();
    const [exportOpen, setExportOpen] = useState(false);

    return (
        <>
            <ExportFormatModal
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                defaultFilename={(title || 'report').replace(/\s+/g, '-').toLowerCase()}
                onExport={async (format) => {
                    if (onExport) await onExport(format);
                    setExportOpen(false);
                }}
            />

            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        {icon && <Icon id={icon} className="text-primary" />}
                        {title}
                    </span>
                }
                subtitle={subtitle}
                actions={
                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<Icon id="arrow-left" />}
                            onClick={() => navigate('reportsHub')}
                        >
                            Reports
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            leftIcon={<Icon id="download" />}
                            onClick={() => setExportOpen(true)}
                            disabled={loading || !!error || empty}
                        >
                            Export
                        </Button>
                    </div>
                }
            />

            {/* Filter bar */}
            {filters && (
                <Card className="mb-4">
                    <CardBody>
                        {filters}
                    </CardBody>
                </Card>
            )}

            {/* Loading state */}
            {loading && (
                <div className="flex items-center justify-center py-24">
                    <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-4 border-primary"></div>
                </div>
            )}

            {/* Error state */}
            {!loading && error && (
                <Card className="mb-4">
                    <CardBody>
                        <div className="text-red-700 bg-red-50 border border-red-200 rounded p-4">
                            <div className="font-semibold mb-1">Failed to load report</div>
                            <div className="text-sm">{error}</div>
                        </div>
                    </CardBody>
                </Card>
            )}

            {/* Content (only when not loading + no error) */}
            {!loading && !error && (
                <>
                    {kpiBand && (
                        <div className="mb-4">
                            {kpiBand}
                        </div>
                    )}

                    {charts && (
                        <div className="mb-4">
                            {charts}
                        </div>
                    )}

                    {empty ? (
                        <Card>
                            <CardBody>
                                <div className="text-center py-12 text-gray-500">
                                    <Icon id="inbox" className="w-10 h-10 mx-auto mb-2 text-gray-400" />
                                    <div className="font-medium">{emptyHint}</div>
                                </div>
                            </CardBody>
                        </Card>
                    ) : (
                        children
                    )}
                </>
            )}
        </>
    );
};

export default ReportPage;
