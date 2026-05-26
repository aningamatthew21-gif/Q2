'use strict';

/**
 * Enhanced Error Handler Middleware
 * Catches all uncaught exceptions thrown during request processing.
 * Prevents stack traces from leaking to the frontend in production.
 */
function errorHandler(err, req, res, next) {
  // Log the full error to the backend console always
  console.error(`💥 [ERROR] ${req.method} ${req.url}`);
  console.error(err.stack || err.message || err);

  const statusCode = err.status || err.statusCode || 500;
  
  // Clean message for the frontend
  let message = err.message || 'An unexpected error occurred on the server.';
  
  // Special handling for Oracle Database errors
  if (err.message && err.message.startsWith('ORA-')) {
    if (err.message.includes('ORA-00001')) {
      message = 'A record with this identifier already exists.';
    } else {
      // Hide raw Oracle SQL from the frontend but keep the ORA code so
      // the user (and us) can diagnose without backend log access. The
      // code on its own does not leak schema names or query structure.
      const codeMatch = err.message.match(/ORA-(\d{5})/);
      const oraCode = codeMatch ? `ORA-${codeMatch[1]}` : 'database error';
      message = `Database error (${oraCode}). Please try again, or contact the administrator if it persists.`;
    }
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    // Provide stack trace ONLY in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

/**
 * Wrap an async Express route handler so that rejected promises
 * are automatically passed to next() for the errorHandler.
 * Replaces the need for try/catch in every controller.
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = { errorHandler, catchAsync };
