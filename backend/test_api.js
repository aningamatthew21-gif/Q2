require('dotenv').config();
const axios = require('axios');
const jwt = require('jsonwebtoken');

async function test() {
  const token = jwt.sign({ email: 'test@example.com', role: 'admin' }, process.env.JWT_SECRET || 'fallback-secret-for-dev', { expiresIn: '1h' });
  
  try {
    const res = await axios.post('http://localhost:3001/api/audit-logs', {
      userId: 'testuser',
      action: 'LOGIN_SUCCESS',
      details: 'User logged in',
      category: 'auth',
      severity: 'info',
      outcome: 'success',
      extraField: 'should go to extra data'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("Success:", res.data);
  } catch (err) {
    if (err.response) {
      console.error("Server Error:", err.response.data);
    } else {
      console.error("Error:", err.message);
    }
  }
}
test();
