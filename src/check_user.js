/**
 * check_user.js - Utility script to verify a user exists in Oracle via the REST API.
 * Run from the backend directory: node check_user.js
 * 
 * This replaces the legacy Firebase Firestore version.
 */

import api from './api.js';

const email = 'aningamatthew21+salse@gmail.com';

async function checkUser() {
    try {
        console.log(`Checking for user: ${email}`);
        const response = await api.get(`/auth/users?email=${encodeURIComponent(email)}`);
        if (response.success && response.user) {
            console.log('User exists:', response.user);
        } else {
            console.log('User not found in Oracle QA_USERS table.');
        }
    } catch (error) {
        console.error('Error checking user:', error.message);
    }
}

checkUser();
