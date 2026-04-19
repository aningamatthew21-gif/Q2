# Release Notes

## Version 1.0.0 (2025-11-28)

We are excited to announce the first public release of the Project Quote Application!

### Highlights

*   **Quoting Module**: Create and manage quotes with an integrated Product Catalog and AI Assistant.
*   **AI Assistant**: Floating chat bubble for natural language interactions (e.g., "Add 50 bags of cement").
*   **Invoice Management**:
    *   **Approval Workflow**: Controller approval process with digital signatures.
    *   **My Invoices**: View and filter your created invoices by Year and Month.
    *   **All Invoices**: Admin view of all invoices in the system.
*   **Dashboards**: Dedicated dashboards for Sales and Controllers with real-time analytics.
*   **Customer Portal**: Secure portal for customers to view and pay invoices.
*   **Inventory Management**: Real-time inventory tracking and updates.

### New Features

*   **Consistent Invoice IDs**: New invoices use `INV-YYYY-TIMESTAMP`, approved invoices use `MIDSA-INV-{SEQ}-{YYYY}-{DD}-{TIME}`.
*   **Filtering**: Added Year and Month filters to all invoice lists.
*   **Sorting**: All lists are sorted by date (newest first).
*   **Dynamic Email**: Invoices can be emailed directly to customers using their contact details.
*   **Currency Toggle**: Switch between USD and GHS in the invoice editor.

### Fixes & Improvements

*   Fixed monthly invoice chart aggregation.
*   Improved login flow with OTP (currently in Dev Mode).
*   Enhanced UI/UX for the Quoting Module and Login Screen.
*   Optimized Firebase initialization and data fetching.

### Known Issues

*   OTP email sending is currently disabled for development (check console for code).
*   Mobile responsiveness is optimized for tablets and desktops; phone layout is in progress.
