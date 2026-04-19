// Simple test script for Firebase Functions
// Run this after deploying functions to test basic functionality

const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Test configuration - replace with your actual Firebase config
const firebaseConfig = {
  // Add your Firebase config here
  // apiKey: "your-api-key",
  // authDomain: "your-project.firebaseapp.com",
  // projectId: "your-project-id",
  // storageBucket: "your-project.appspot.com",
  // messagingSenderId: "123456789",
  // appId: "your-app-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

// Test the generateFullReport function
async function testGenerateReport() {
  try {
    console.log('Testing generateFullReport function...');
    
    const generateReport = httpsCallable(functions, 'generateFullReport');
    
    const result = await generateReport({
      appId: 'test-app-id',
      role: 'controller',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      includeLegacy: false
    });
    
    console.log('✅ Function call successful!');
    console.log('Report data:', JSON.stringify(result.data, null, 2));
    
  } catch (error) {
    console.error('❌ Function call failed:', error);
    console.error('Error details:', error.details || error.message);
  }
}

// Test the exportReportCsv function
async function testExportCsv() {
  try {
    console.log('\nTesting exportReportCsv function...');
    
    // First generate a report to get a reportId
    const generateReport = httpsCallable(functions, 'generateFullReport');
    const reportResult = await generateReport({
      appId: 'test-app-id',
      role: 'controller',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      includeLegacy: false
    });
    
    const reportId = reportResult.data.cachedReportId;
    console.log('Generated report ID:', reportId);
    
    // Now test CSV export
    const response = await fetch('/__/functions/exportReportCsv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        appId: 'test-app-id', 
        reportId: reportId 
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ CSV export successful!');
      console.log('Download URL:', result.url);
    } else {
      console.error('❌ CSV export failed:', response.status, response.statusText);
    }
    
  } catch (error) {
    console.error('❌ CSV export test failed:', error);
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting Firebase Functions tests...\n');
  
  await testGenerateReport();
  await testExportCsv();
  
  console.log('\n✨ Tests completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testGenerateReport, testExportCsv }; 