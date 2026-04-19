import api from '../api';

export class AuthService {
    // Constructor no longer needs the Firestore db instance
    constructor(db = null) {
        this.db = db;
    }

    async getUserByEmail(email) {
        // Now handled entirely during /auth/verify-otp.
        // We shouldn't need to fetch user separately before login.
        // But if required later, GET /api/auth/me handles it.
        return null;
    }

    async createUser(email, role = 'sales') {
        // Auto-handled in backend verify-otp route
        return null; 
    }

    async validateOtp(email, otp) {
        try {
            // Let the AppContext call our backend API directly instead
            // We return a mock truthy value here because AppContext does this manually below.
            // Our backend combines validate + login + generate token in one step,
            // which we handle in AppContext.jsx
            return true; 
        } catch (error) {
            console.error('OTP validation error:', error);
            return false;
        }
    }

    async generateOtp(email) {
       // Handled by backend sendOtp route
       return null;
    }

    async deleteOtp(email) {
        // Handled auto by backend after success
    }

    async sendOtp(email) {
        try {
            console.log('🔍 [DEBUG] AuthService: Requesting backend to send OTP:', email);
            await api.post('/auth/send-otp', { email });
            return true;
        } catch (error) {
            console.error('Failed to send OTP:', error);
            throw error;
        }
    }

    async verifyEmailExists(email) {
        // Not strictly needed with our lazy-auth flow
        return true;
    }
};
