# Operations Runbook

This runbook details the procedures for maintaining, deploying, and troubleshooting the Project Quote Application.

## 1. Deployment

### Prerequisites
*   Access to the GitHub repository.
*   Firebase CLI installed (`npm install -g firebase-tools`).
*   Authorized Firebase account.

### Steps to Deploy
1.  **Build the Application**:
    ```bash
    npm install
    npm run build
    ```
2.  **Deploy to Firebase Hosting**:
    ```bash
    firebase login
    firebase deploy
    ```

### Rollback Procedure
If a deployment fails or introduces critical bugs:
1.  Go to the [Firebase Console Hosting](https://console.firebase.google.com/).
2.  Find the previous stable release in the release history.
3.  Click "Rollback" to revert to that version immediately.

## 2. Monitoring & Alerting

*   **Application Health**: Monitor the Firebase Console for usage spikes or quota limits.
*   **Error Logging**: Check the browser console and `AuditTrail` page in the app for runtime errors.
*   **Performance**: Use Chrome DevTools Lighthouse to audit performance periodically.

## 3. Backup & Recovery

### Database Backups
*   **Automated**: Configure Firebase scheduled backups (via Google Cloud Console) for Cloud Firestore.
*   **Manual**: Use the `gcloud` CLI to export data:
    ```bash
    gcloud firestore export gs://[BUCKET_NAME]
    ```

### Code Backup
*   The codebase is version-controlled in GitHub.
*   Use the `backup_project.bat` script locally to push changes to the remote repository frequently.

## 4. Common Tasks

### Clearing Cache
If users report not seeing the latest version after deployment:
*   Instruct them to hard refresh their browser (`Ctrl+F5` or `Cmd+Shift+R`).
*   Verify the service worker (if applicable) is updating correctly.

### Managing Users
*   **Add User**: Currently handled via the `check_user.js` script or auto-creation logic in `AppContext`.
*   **Reset User**: Delete the user document in the `users` collection in Firestore to force a re-registration.

### Updating Configuration
*   **Tax Settings**: Update the `settings/taxes` document in Firestore via the **Tax Settings** page in the app.
*   **Signatures**: Manage approval signatures in the `settings/signatures` document.
