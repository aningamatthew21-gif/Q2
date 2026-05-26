/**
 * ReportExportService — Module 5
 *
 * Single utility every report page calls to export its data. Owns the
 * three export formats (PDF, XLSX, ZIP) so the per-report code stays
 * focused on data + presentation, not on PDF/Excel mechanics.
 *
 * The input is the standard envelope produced by `backend/routes/
 * reports/_shared.js#envelope()`:
 *
 *   {
 *     title: 'AR Aging',
 *     subtitle: 'As of 2026-05-24',
 *     asOfDate: Date,
 *     filtersApplied: [{label, value}, ...],
 *     kpis: [{label, value, fmt}, ...],   // displayed in PDF summary
 *     columns: [{key, label, type, fmt}],
 *     rows: [...],
 *     totals: { colKey: N, ... }
 *   }
 *
 * Plus an `options.filename` (without extension) chosen in the modal.
 *
 *   await exportPDF(envelope, { filename: 'ar-aging-2026-05-24' });
 *   await exportXLSX(envelope, { filename: 'ar-aging-2026-05-24' });
 *   await exportZip(envelope,  { filename: 'ar-aging-2026-05-24' });
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const COMPANY = 'MIDSA'; // Header / branding string

// ────────────────────────────────────────────────────────────────────────
// Cell-value formatters
// ────────────────────────────────────────────────────────────────────────

function fmtCellForDisplay(value, type, fmt) {
  if (value == null) return '';
  switch (type) {
    case 'currency':
      return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    case 'percent':
      return `${Number(value).toFixed(1)} %`;
    case 'number':
      return Number(value).toLocaleString();
    case 'date': {
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    }
    default:
      return String(value);
  }
}

// Excel-native value (preserves typing for sum/sort)
function fmtCellForXlsx(value, type) {
  if (value == null) return null;
  switch (type) {
    case 'currency':
    case 'number':
    case 'percent':
      return Number(value);
    case 'date': {
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    default:
      return String(value);
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────────────────
// PDF export
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a branded PDF: company header, report title, filter caption,
 * KPI strip, detail table (paginated), footer with page numbers +
 * "Confidential" + run timestamp.
 *
 * Returns the jsPDF instance so callers (or `exportZip`) can grab the
 * blob without forcing a download.
 */
export function buildPDF(report) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth  = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // ── Header ──────────────────────────────────────────────────────────
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(100);
  pdf.text(COMPANY, 14, 12);

  pdf.setFontSize(16);
  pdf.setTextColor(20);
  pdf.text(report.title || 'Report', 14, 22);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(80);
  if (report.subtitle) pdf.text(report.subtitle, 14, 28);

  // ── Filter caption ──────────────────────────────────────────────────
  let nextY = 34;
  if (report.filtersApplied && report.filtersApplied.length > 0) {
    pdf.setFontSize(8);
    pdf.setTextColor(110);
    const caption = report.filtersApplied
      .map(f => `${f.label}: ${f.value}`)
      .join('   ·   ');
    pdf.text(`Filters — ${caption}`, 14, nextY);
    nextY += 5;
  }

  // ── KPI strip ───────────────────────────────────────────────────────
  if (report.kpis && report.kpis.length > 0) {
    const boxW = (pageWidth - 28) / report.kpis.length;
    pdf.setDrawColor(220);
    pdf.setFillColor(248, 250, 252);
    report.kpis.forEach((kpi, i) => {
      const x = 14 + i * boxW;
      pdf.roundedRect(x, nextY, boxW - 2, 16, 1.5, 1.5, 'FD');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(110);
      pdf.text(String(kpi.label || ''), x + 3, nextY + 5);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(20);
      pdf.text(String(kpi.value ?? '—'), x + 3, nextY + 12);
    });
    nextY += 20;
  }

  // ── Detail table ────────────────────────────────────────────────────
  const cols = report.columns || [];
  const rows = report.rows || [];
  const body = rows.map(r =>
    cols.map(c => fmtCellForDisplay(r[c.key], c.type, c.fmt))
  );

  // Optional totals row (appended in bold)
  if (report.totals && Object.keys(report.totals).length > 0) {
    body.push(cols.map((c, i) => {
      if (i === 0) return 'TOTAL';
      const v = report.totals[c.key];
      return v != null ? fmtCellForDisplay(v, c.type, c.fmt) : '';
    }));
  }

  if (cols.length > 0) {
    autoTable(pdf, {
      startY: nextY,
      head: [cols.map(c => c.label || c.key)],
      body,
      styles:     { fontSize: 7.5, cellPadding: 1.8, overflow: 'linebreak' },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      // Right-align numeric / currency / percent columns
      columnStyles: cols.reduce((acc, c, i) => {
        if (['number', 'currency', 'percent'].includes(c.type)) {
          acc[i] = { halign: 'right' };
        }
        return acc;
      }, {}),
      // Bold the totals row (always the last one when totals are present)
      didParseCell: (data) => {
        if (report.totals && data.row.index === body.length - 1 && data.section === 'body') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [232, 240, 254];
        }
      },
      margin: { left: 14, right: 14 },
      didDrawPage: (data) => {
        // Footer
        pdf.setFontSize(7);
        pdf.setTextColor(140);
        pdf.text(
          `Page ${data.pageNumber}   ·   Confidential   ·   Generated ${new Date().toLocaleString()}`,
          pageWidth / 2,
          pageHeight - 6,
          { align: 'center' }
        );
        pdf.setTextColor(0);
      }
    });
  } else {
    // No columns — write a "no data" line
    pdf.setFontSize(10);
    pdf.setTextColor(150);
    pdf.text('No data to display.', 14, nextY + 10);
  }

  return pdf;
}

export async function exportPDF(report, { filename = 'report' } = {}) {
  const pdf = buildPDF(report);
  pdf.save(`${filename}.pdf`);
}

// ────────────────────────────────────────────────────────────────────────
// XLSX export
// ────────────────────────────────────────────────────────────────────────

/**
 * Build an Excel workbook with two sheets:
 *   1. "Report"   — detail table with frozen header, totals row, formats
 *   2. "Run Info" — title, subtitle, run time, filters applied, KPIs
 *
 * Returns an ArrayBuffer for ZIP packaging or direct download.
 */
export async function buildXLSX(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator       = COMPANY;
  wb.created       = new Date();
  wb.lastModifiedBy = COMPANY;

  // ── Sheet 1: Report ─────────────────────────────────────────────────
  const ws = wb.addWorksheet('Report', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  const cols = report.columns || [];
  const rows = report.rows || [];

  // Header row
  ws.columns = cols.map(c => ({
    header: c.label || c.key,
    key:    c.key,
    width:  Math.max(12, Math.min(40, (c.label || c.key).length + 4))
  }));
  // Apply header styling AFTER ws.columns sets it
  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  hdr.alignment = { vertical: 'middle', horizontal: 'left' };
  hdr.height = 22;

  // Data rows + per-column number formats
  rows.forEach((r) => {
    const row = ws.addRow(
      cols.reduce((obj, c) => {
        obj[c.key] = fmtCellForXlsx(r[c.key], c.type);
        return obj;
      }, {})
    );
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      switch (c.type) {
        case 'currency':
          cell.numFmt = '#,##0.00';
          cell.alignment = { horizontal: 'right' };
          break;
        case 'number':
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
          break;
        case 'percent':
          cell.numFmt = '0.0"%"';
          cell.alignment = { horizontal: 'right' };
          break;
        case 'date':
          cell.numFmt = 'yyyy-mm-dd';
          break;
      }
    });
  });

  // Totals row
  if (report.totals && Object.keys(report.totals).length > 0) {
    const totalsRow = ws.addRow(
      cols.reduce((obj, c, i) => {
        if (i === 0) {
          obj[c.key] = 'TOTAL';
        } else if (report.totals[c.key] != null) {
          obj[c.key] = fmtCellForXlsx(report.totals[c.key], c.type);
        } else {
          obj[c.key] = null;
        }
        return obj;
      }, {})
    );
    totalsRow.font = { bold: true };
    totalsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
    cols.forEach((c, i) => {
      const cell = totalsRow.getCell(i + 1);
      switch (c.type) {
        case 'currency': cell.numFmt = '#,##0.00';   break;
        case 'number':   cell.numFmt = '#,##0';      break;
        case 'percent':  cell.numFmt = '0.0"%"';     break;
        case 'date':     cell.numFmt = 'yyyy-mm-dd'; break;
      }
    });
  }

  // ── Sheet 2: Run Info ───────────────────────────────────────────────
  const info = wb.addWorksheet('Run Info');
  info.columns = [{ width: 28 }, { width: 60 }];
  const rowsToAdd = [
    ['Report',     report.title || ''],
    ['Subtitle',   report.subtitle || ''],
    ['Generated',  new Date().toLocaleString()],
    ['Company',    COMPANY],
    ['As of',      report.asOfDate ? new Date(report.asOfDate).toLocaleString() : ''],
    ['', ''],
    ['FILTERS APPLIED', '']
  ];
  rowsToAdd.forEach(([k, v]) => info.addRow([k, v]));
  (report.filtersApplied || []).forEach(f => {
    info.addRow([`  · ${f.label}`, f.value]);
  });
  if (report.kpis && report.kpis.length > 0) {
    info.addRow(['', '']);
    info.addRow(['KPIs', '']);
    report.kpis.forEach(k => info.addRow([`  · ${k.label}`, k.value]));
  }
  info.getRow(1).font = { bold: true };
  info.getRow(7).font = { bold: true };

  return await wb.xlsx.writeBuffer();
}

export async function exportXLSX(report, { filename = 'report' } = {}) {
  const buf = await buildXLSX(report);
  triggerDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
}

// ────────────────────────────────────────────────────────────────────────
// ZIP export (PDF + XLSX)
// ────────────────────────────────────────────────────────────────────────

export async function exportZip(report, { filename = 'report' } = {}) {
  const zip = new JSZip();

  const pdf = buildPDF(report);
  // jsPDF.output('arraybuffer') returns the PDF bytes
  zip.file(`${filename}.pdf`,  pdf.output('arraybuffer'));

  const xlsx = await buildXLSX(report);
  zip.file(`${filename}.xlsx`, xlsx);

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(zipBlob, `${filename}.zip`);
}

/**
 * Single dispatch — used by ReportPage's onExport handler so callers
 * don't switch on format themselves.
 */
export async function exportReport(format, report, options) {
  if (format === 'pdf')  return exportPDF(report, options);
  if (format === 'xlsx') return exportXLSX(report, options);
  if (format === 'zip')  return exportZip(report, options);
  throw new Error(`Unknown export format: ${format}`);
}

export default {
  exportPDF,
  exportXLSX,
  exportZip,
  exportReport,
  buildPDF,
  buildXLSX
};
