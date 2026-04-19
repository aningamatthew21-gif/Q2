# Architecture Overview

## 1. High-Level Overview

The Project Quote Application is a modern single-page application (SPA) built to streamline the quoting and invoicing process. It leverages a serverless architecture using Google Firebase for backend services, ensuring scalability and real-time data synchronization.

## 2. Technology Stack

*   **Frontend**: React (v19) with Vite (v7) for fast build and development.
*   **Styling**: Tailwind CSS (v4) for utility-first styling.
*   **Backend**: Firebase (v12)
    *   **Authentication**: Firebase Auth (Anonymous & Email/OTP).
    *   **Database**: Cloud Firestore (NoSQL) for real-time data storage.
    *   **Hosting**: Firebase Hosting (implied for production).
*   **PDF Generation**: jsPDF and autoTable for client-side invoice generation.
*   **Charts**: Recharts for analytics dashboards.

## 3. System Architecture Diagram

```mermaid
graph TD
    User[User (Browser)] -->|HTTPS| CDN[Firebase Hosting]
    User -->|Auth SDK| Auth[Firebase Authentication]
    User -->|Firestore SDK| DB[(Cloud Firestore)]
    
    subgraph Frontend [React Application]
        Router[React Router]
        Context[App Context]
        Pages[Pages (Dashboard, Quoting, Invoices)]
        Services[Services (Auth, PDF, Logger)]
    end
    
    CDN --> Frontend
    
    Frontend -->|Read/Write| DB
    Frontend -->|Login/OTP| Auth
```

## 4. Data Flow

1.  **Authentication**: Users log in via Email/OTP. The `AuthService` handles the interaction with Firebase Auth.
2.  **Data Fetching**: Components subscribe to Firestore collections (e.g., `invoices`, `inventory`) using `onSnapshot` for real-time updates.
3.  **State Management**: `AppContext` provides global state for user sessions and shared data. Local component state manages UI interactions.
4.  **Business Logic**:
    *   **Quoting**: Users select items from the `inventory` collection. Quotes are saved as drafts or submitted.
    *   **Invoicing**: Submitted quotes become pending invoices. Controllers approve them, triggering stock deductions in `inventory`.
    *   **Analytics**: Dashboards aggregate data from `invoices` to calculate sales performance and inventory health.

## 5. Security Controls

*   **Authentication**: All users must be authenticated to access the application.
*   **Authorization**: Role-based access control (RBAC) restricts access to specific pages (e.g., Controller Dashboard vs. Sales Dashboard).
*   **Data Validation**: Input validation on forms and Firestore security rules (to be implemented) enforce data integrity.

## 6. External Integrations

*   **EmailJS**: Used for sending OTPs and notifications (currently in Dev Mode).
*   **GitHub**: Source code management and version control.
