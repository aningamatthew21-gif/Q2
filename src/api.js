import axios from 'axios';

// Create a singleton axios instance configured to talk to the Express proxy
const api = axios.create({
  baseURL: '/api', // Vite proxy routes this to http://localhost:3001/api naturally
  headers: {
    'Content-Type': 'application/json'
  }
});

// ────────────────────────────────────────────────────────────────────
// SP1-H1+H2+H3 — refresh-token pattern (15-min access + 7-day refresh)
//
// Standards anchor:
//   - ISO/IEC 27001:2022 A.5.18 / A.8.5 — revocable, short-lived primary
//     credentials; long-lived secondary credentials replayed only via
//     the refresh endpoint which can revoke server-side.
//   - OWASP ASVS v4.0 §3.3 — session termination handled centrally.
//
// Concurrency-safe refresh: if 10 parallel requests all hit 401 at
// roughly the same time (very common — user opens dashboard, all the
// real-time hooks fetch simultaneously), we MUST only fire ONE /refresh
// request and have the other 9 await its result. Otherwise we'd burn 10
// refresh tokens and the rotation pattern fails.
//
// Pattern: a module-scoped `refreshPromise` that's null when no refresh
// is in flight, and a Promise<newAccessToken> when one is. Concurrent
// 401s `.then()` onto the same promise.
// ────────────────────────────────────────────────────────────────────

let refreshPromise = null;

async function performRefresh() {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) {
    throw new Error('No refresh token available — full login required.');
  }
  // Use a bare fetch (NOT this api instance) so we don't recurse into
  // the same interceptor if /refresh itself returns 401.
  const resp = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body?.error || `Refresh failed (HTTP ${resp.status})`);
  }
  const data = await resp.json();
  if (!data?.accessToken || !data?.refreshToken) {
    throw new Error('Refresh response missing tokens.');
  }
  // Persist the rotated pair. The server has revoked the old refresh
  // token — any future use of the old one will 401.
  localStorage.setItem('auth_token',    data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  if (data.user) {
    localStorage.setItem('app_user', JSON.stringify(data.user));
  }
  return data.accessToken;
}

function clearSessionAndRedirect() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('app_user');
  // Force a navigation to the login page. Using location.assign rather
  // than hash so the SPA shell remounts cleanly with no stale state.
  if (typeof window !== 'undefined') {
    window.location.assign(`${window.location.pathname}?page=login`);
  }
}

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

// Add a response interceptor for global error handling + auto-refresh
api.interceptors.response.use(
  (response) => {
    // Standardize to always return the data block directly if success=true exists
    if (response.data && response.data.success === false) {
      console.warn('API Warning:', response.data);
    }
    return response.data;
  },
  async (error) => {
    const original = error.config;

    if (error.response) {
      // ── 401 handling: try one refresh per request, then give up ──
      // `_retry` flag prevents an infinite loop if the retried request
      // also returns 401 (e.g. permissions issue, not just token expiry).
      if (
        error.response.status === 401 &&
        !original?._retry &&
        // Don't try to refresh on the auth endpoints themselves
        !original?.url?.includes('/auth/')
      ) {
        original._retry = true;
        try {
          if (!refreshPromise) {
            refreshPromise = performRefresh().finally(() => {
              // Whether success or failure, clear the in-flight slot so
              // the NEXT 401 can try again.
              refreshPromise = null;
            });
          }
          const newAccessToken = await refreshPromise;
          // Re-fire the original request with the fresh token
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(original);
        } catch (refreshErr) {
          // Refresh itself failed — session is dead, force re-login
          console.warn('[api] Token refresh failed:', refreshErr.message);
          clearSessionAndRedirect();
          return Promise.reject(refreshErr);
        }
      }

      // Other 401s (auth-endpoint failures, retry failed): hard logout
      if (error.response.status === 401) {
        console.error('API Error Response:', error.response.data);
        clearSessionAndRedirect();
      } else {
        console.error('API Error Response:', error.response.data);
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
