## Preview before submit — Investigation Report

### What generates PDFs today

- **Engine**: Client-side `jsPDF` with `jspdf-autotable`.
  - Code: `src/services/PDFService.js` defines `generateInvoicePDF`, `generateQuotePDF`, and download helpers.

- **Templates**: None as separate HTML/EJS/HBS. Layout is drawn procedurally with jsPDF calls (text positions, colors, and an AutoTable for line items).

- **CSS/Fonts**:
  - Uses built-in jsPDF fonts: `helvetica` in both `normal` and `bold` styles; colors via `setTextColor`.
  - No external CSS file or custom fonts embedded.
  - Tables use `jspdf-autotable` with inline style options (header fill color, text color, widths).

- **Images/Transforms**:
  - Controller signature image (PNG data URL) is added if present.
  - No watermarking or image compression detected.
  - Totals and taxes are computed dynamically; taxes can be sourced from a controller tax config or fall back to defaults.

- **Pre/Post processing**:
  - Currency formatting helper.
  - Tax calculation helpers: `calculateTaxes` (defaults) and `calculateTaxesFromConfig` (controller-provided config).
  - File naming at download time via `pdf.save(...)`.

### Key code references

```151:171:src/services/PDFService.js
export class PDFService {
    static generateInvoicePDF(invoiceData) {
        // jsPDF { orientation: 'portrait', unit: 'mm', format: 'a4' }
        // Header, customer block, items AutoTable, dynamic taxes, signature, footer
```

```311:339:src/services/PDFService.js
autoTable(pdf, {
    head: [['S/N', 'Item Description', 'Qty', 'Unit Price (GHC)', 'Total (GHC)']],
    body: tableData,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [0,102,204], textColor: [255,255,255] },
})
```

```346:353:src/services/PDFService.js
if (invoiceData.taxConfig && invoiceData.taxConfig.length > 0) {
  taxResults = calculateTaxesFromConfig(invoiceData.subtotal || 0, invoiceData.taxConfig);
} else {
  taxResults = calculateTaxes(invoiceData.subtotal || 0);
}
```

```469:501:src/services/PDFService.js
// Signature block (controllerSignature data URL) with name and subsidiary
```

### Current submit-for-approval flow

- Initiated from the quoting/editor screen.
- Writes the invoice to Firestore with `status: 'Pending Approval'`; no server PDF generation endpoint is involved.

```4645:4681:src/App.jsx
const handleSubmitForApproval = async () => {
  // ...builds invoice payload
  status: 'Pending Approval',
  date: new Date().toISOString().split('T')[0],
  total: totals.grandTotal || totals.subtotal || 0
}
```

### Existing server endpoints related to PDFs

- None. Backend provides tax settings endpoints only:

```932:941:backend/server.js
app.get('/api/tax-settings', ...)
app.post('/api/tax-settings', ...)
```

### Findings summary

- PDF generation is entirely client-side with jsPDF. There is no server-side renderer or `/generate-pdf` endpoint to reuse.
- The final exported PDF uses the jsPDF pipeline in `PDFService`. Therefore, a preview that uses the same jsPDF calls will be pixel-identical.

### Recommended preview approach

**Choose B (Client-side preview) now**

- Rationale:
  - The final export is already client-side jsPDF. Generating the preview with the same `PDFService` functions ensures a byte-identical layout without introducing a server dependency.
  - Fast and low-risk: no round-trip, no new infra. We can render the produced PDF bytes in an `<iframe src="data:application/pdf;base64,...">` or via PDF.js for page/zoom controls.

- Implementation sketch:
  - Add `PreviewModal.jsx` that:
    1) On open, runs `PDFService.generateInvoicePDF(currentPayload)` (or quote variant) to get a jsPDF instance.
    2) Converts to base64: `const base64 = pdf.output('datauristring').replace('data:application/pdf;filename=generated.pdf;base64,','');`
    3) Embeds in iframe or PDF.js viewer with basic navigation/zoom.
    4) Buttons: Back & Edit (close modal), Continue & Submit (invoke existing `handleSubmitForApproval`).
  - Gate by role/permission before allowing preview generation.
  - Show spinner and retry on errors; fall back to HTML render if jsPDF fails.

**Path to A (Server-side) later**

- If we later need server-side parity (security/auditing, heavy docs, or exact font embedding), extract the PDF layout into a shared module and add a backend route:
  - Create `shared/pdf/buildInvoicePdf.js` exporting a pure function that returns a `Uint8Array`/Buffer.
  - Import it in both frontend and backend (Node-compatible jsPDF usage may require polyfills or switching to a headless HTML renderer like Puppeteer for CSS fidelity).
  - Add `POST /api/preview-pdf` that returns `{ filename, base64Pdf }` with auth + rate limiting.

### Accessibility, security, performance notes

- Modal: focus trap, ARIA roles, Esc to close, keyboard navigation for buttons.
- Security: allow preview only for authorized submitters; rate-limit if later moved server-side.
- Performance: show spinner; jsPDF generation is typically sub-seconds for modest documents.
- Storage: preview PDFs should not be persisted; use in-memory base64.

### Next steps (if approved)

1) Add `components/PreviewModal.jsx` and wire it to the Submit button in the editor flow.
2) Use `PDFService` to produce base64 and render in an iframe or PDF.js viewer.
3) Ensure Continue & Submit calls the existing Firestore-based submit logic.
4) Add basic tests (happy path + error fallback).


