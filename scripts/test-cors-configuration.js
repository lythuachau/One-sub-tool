/**
 * Test script to verify CORS configuration across all services
 */

const axios = require('axios');
const { PORTS } = require('../server/config');

// Test configuration
const TEST_TIMEOUT = 5000; // 5 seconds
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000; // 2 seconds

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test CORS for a specific service
 */
async function testServiceCors(serviceName, port, endpoint = '/health') {
  const baseUrl = `http://localhost:${port}`;
  const testUrl = `${baseUrl}${endpoint}`;
  
  console.log(`\n🔍 Testing ${serviceName} (Port ${port}):`);
  console.log(`   URL: ${testUrl}`);
  
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      // Test with different origins to verify CORS
      const origins = [
        `http://localhost:${PORTS.FRONTEND}`,
        `http://127.0.0.1:${PORTS.FRONTEND}`,
        `http://localhost:${PORTS.BACKEND}`,
        `http://127.0.0.1:${PORTS.BACKEND}`
      ];
      
      for (const origin of origins) {
        const response = await axios.get(testUrl, {
          timeout: TEST_TIMEOUT,
          headers: {
            'Origin': origin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'Content-Type'
          }
        });
        
        console.log(`   ✅ Origin ${origin}: ${response.status} ${response.statusText}`);
        
        // Check CORS headers in response
        const corsHeaders = {
          'access-control-allow-origin': response.headers['access-control-allow-origin'],
          'access-control-allow-credentials': response.headers['access-control-allow-credentials'],
          'access-control-allow-methods': response.headers['access-control-allow-methods']
        };
        
        if (corsHeaders['access-control-allow-origin']) {
          console.log(`      CORS Origin: ${corsHeaders['access-control-allow-origin']}`);
        }
        if (corsHeaders['access-control-allow-credentials']) {
          console.log(`      CORS Credentials: ${corsHeaders['access-control-allow-credentials']}`);
        }
      }
      
      return { success: true, serviceName, port };
      
    } catch (error) {
      if (attempt === RETRY_ATTEMPTS) {
        console.log(`   ❌ Failed after ${RETRY_ATTEMPTS} attempts: ${error.message}`);
        return { success: false, serviceName, port, error: error.message };
      } else {
        console.log(`   ⚠️  Attempt ${attempt} failed, retrying in ${RETRY_DELAY}ms...`);
        await sleep(RETRY_DELAY);
      }
    }
  }
}

/**
 * Test OPTIONS preflight request
 */
async function testPreflightRequest(serviceName, port, endpoint = '/health') {
  const baseUrl = `http://localhost:${port}`;
  const testUrl = `${baseUrl}${endpoint}`;
  
  console.log(`\n🔍 Testing preflight request for ${serviceName}:`);
  
  try {
    const response = await axios.options(testUrl, {
      timeout: TEST_TIMEOUT,
      headers: {
        'Origin': `http://localhost:${PORTS.FRONTEND}`,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization'
      }
    });
    
    console.log(`   ✅ Preflight successful: ${response.status} ${response.statusText}`);
    
    // Check preflight response headers
    const preflightHeaders = {
      'access-control-allow-origin': response.headers['access-control-allow-origin'],
      'access-control-allow-methods': response.headers['access-control-allow-methods'],
      'access-control-allow-headers': response.headers['access-control-allow-headers'],
      'access-control-allow-credentials': response.headers['access-control-allow-credentials']
    };
    
    Object.entries(preflightHeaders).forEach(([header, value]) => {
      if (value) {
        console.log(`      ${header}: ${value}`);
      }
    });
    
    return { success: true, serviceName, port };
    
  } catch (error) {
    console.log(`   ❌ Preflight failed: ${error.message}`);
    return { success: false, serviceName, port, error: error.message };
  }
}

/**
 * Main test function
 */
async function testAllServices() {
  console.log('🧪 Testing CORS Configuration Across All Services');
  console.log('==================================================\n');
  
  const services = [
    { name: 'Backend Server', port: PORTS.BACKEND, endpoint: '/api/health' },
    { name: 'Video Renderer', port: PORTS.VIDEO_RENDERER, endpoint: '/health' },
    { name: 'VieNeu-TTS Service', port: PORTS.NARRATION, endpoint: '/health' },
    { name: 'OmniVoice Service', port: PORTS.CHATTERBOX, endpoint: '/health' }
  ];
  
  const results = [];
  
  // Test basic CORS for each service
  for (const service of services) {
    const result = await testServiceCors(service.name, service.port, service.endpoint);
    results.push(result);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('🚀 Testing Preflight Requests');
  console.log('='.repeat(50));
  
  // Test preflight requests
  for (const service of services) {
    const result = await testPreflightRequest(service.name, service.port, service.endpoint);
    results.push({ ...result, type: 'preflight' });
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Results Summary');
  console.log('='.repeat(50));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n✅ Successful tests: ${successful.length}`);
  console.log(`❌ Failed tests: ${failed.length}`);
  
  if (failed.length > 0) {
    console.log('\n❌ Failed Services:');
    failed.forEach(result => {
      console.log(`   • ${result.serviceName} (Port ${result.port}): ${result.error}`);
    });
  }
  
  if (successful.length === results.length) {
    console.log('\n🎉 All CORS tests passed! Your services are properly configured.');
  } else {
    console.log('\n⚠️  Some CORS tests failed. Please check the failed services.');
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  testAllServices().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = {
  testServiceCors,
  testPreflightRequest,
  testAllServices
};
