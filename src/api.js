import axios from 'axios';

// Create a singleton axios instance configured to talk to the Express proxy
const api = axios.create({
  baseURL: '/api', // Vite proxy routes this to http://localhost:3001/api naturally
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add a request interceptor to inject the JWT auth proxy
api.interceptors.request.use(
  (config) => {
    // Get token from localStorage (set during auth phase)
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor for global error handling
api.interceptors.response.use(
  (response) => {
    // Standardize to always return the data block directly if success=true exists
    if (response.data && response.data.success === false) {
      console.warn('API Warning:', response.data);
    }
    return response.data;
  },
  (error) => {
    if (error.response) {
      console.error('API Error Response:', error.response.data);
      if (error.response.status === 401) {
        // Auto-logout if token expires
        localStorage.removeItem('auth_token');
        localStorage.removeItem('app_user');
        window.location.hash = '#login';
      }
    } else if (error.request) {
      console.error('API Error: No response received connecting to backend');
    } else {
      console.error('API Error:', error.message);
    }
    return Promise.reject(error);
  }
);

export default api;
