/**
 * v2 barrel — single import path for the Fluent 2 design system.
 *
 *   import { Button, PageTitle, DataTable } from '../components/v2';
 *
 * Keeping a barrel here lets pages import primitives by name without
 * worrying about file layout — easier diffs during the migration and
 * cleaner page modules.
 */

// Shell
export { default as AppShell }   from './AppShell';
export { default as TopBar }     from './TopBar';
export { default as LeftNav }    from './LeftNav';
export { default as StatusBar }  from './StatusBar';

// Primitives
export { default as Button }       from './Button';
export { default as Card, CardHead, CardBody } from './Card';
export { default as StatusBadge }  from './StatusBadge';
export { default as Breadcrumb }   from './Breadcrumb';
export { default as PageTitle }    from './PageTitle';
export { default as Tabs }         from './Tabs';
export { default as CommandBar }   from './CommandBar';
export { default as FilterChips }  from './FilterChips';
export { default as Dialog }       from './Dialog';
export { default as EmptyState }   from './EmptyState';
export { default as DetailPanel }  from './DetailPanel';

// Data + charts
export { default as MetricTile } from './MetricTile';
export { default as ChartCard, CHART_COLORS, CHART_SERIES } from './ChartCard';
export { default as DataTable }  from './DataTable';

// Prompt / confirm system (replaces native window.prompt/confirm)
export { PromptProvider, usePrompt } from './PromptDialog';

// Sortable table headers + hook (for hand-written tables)
export { default as SortableHeader, useSortable } from './SortableHeader';

// Custom in-app PDF viewer
export { default as PdfViewer } from './PdfViewer';

// Drag-and-drop file picker with thumbnails
export { default as FileDropzone } from './FileDropzone';

// Motion tokens (for ad-hoc animations elsewhere)
export * from './motion';
