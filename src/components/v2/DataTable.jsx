import React, { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table';
import { motion } from 'framer-motion';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import clsx from 'clsx';
import { staggerItem } from './motion';
import EmptyState from './EmptyState';

/**
 * DataTable — TanStack Table v8 wrapper styled for Fluent 2.
 *
 *   <DataTable
 *     columns={[
 *       { accessorKey:'invoiceId', header:'Invoice', mono:true },
 *       { accessorKey:'customer',  header:'Customer' },
 *       { accessorKey:'total',     header:'Total', align:'right',
 *         cell: row => fmt(row.getValue()) },
 *     ]}
 *     data={rows}
 *     onRowClick={(row) => openPanel(row.original)}
 *     density="compact"          // 'compact' | 'comfortable'
 *     selectedId={previewId}
 *     getRowId={(r) => r.id}
 *     emptyState={<EmptyState ... />}
 *   />
 */
export default function DataTable({
  columns = [],
  data = [],
  onRowClick,
  density = 'compact',
  selectedId,
  getRowId,
  emptyState,
  className = ''
}) {
  const [sorting, setSorting] = useState([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId
  });

  const rowPad = density === 'comfortable' ? 'py-2.5' : 'py-1.5';

  return (
    <div className={clsx('w-full overflow-x-auto', className)}>
      <table className="w-full text-[13px] border-collapse">
        <thead className="bg-n-50 sticky top-0 z-10">
          <tr>
            {table.getFlatHeaders().map((h) => {
              const meta = h.column.columnDef;
              const canSort = h.column.getCanSort();
              return (
                <th
                  key={h.id}
                  style={{ width: meta.width, minWidth: meta.minWidth }}
                  className={clsx(
                    'px-3 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600',
                    'border-b border-n-200',
                    meta.align === 'right'  && 'text-right',
                    meta.align === 'center' && 'text-center',
                    canSort && 'cursor-pointer select-none hover:text-n-800'
                  )}
                  onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {canSort && (
                      h.column.getIsSorted() === 'asc'
                        ? <ArrowUp className="w-3 h-3" />
                        : h.column.getIsSorted() === 'desc'
                        ? <ArrowDown className="w-3 h-3" />
                        : <ChevronsUpDown className="w-3 h-3 text-n-300" />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, i) => {
            const isSelected = selectedId !== undefined && row.id === String(selectedId);
            return (
              <motion.tr
                key={row.id}
                variants={staggerItem}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(
                  'border-b border-n-100 transition-colors',
                  onRowClick && 'cursor-pointer',
                  isSelected
                    ? 'bg-accent-soft/60 hover:bg-accent-soft'
                    : 'hover:bg-n-50'
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef;
                  return (
                    <td
                      key={cell.id}
                      className={clsx(
                        'px-3 text-n-700',
                        rowPad,
                        meta.align === 'right'  && 'text-right',
                        meta.align === 'center' && 'text-center',
                        meta.mono && 'font-mono-num text-[12.5px]'
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </motion.tr>
            );
          })}
        </tbody>
      </table>
      {data.length === 0 && (emptyState ?? <EmptyState />)}
    </div>
  );
}
