/**
 * Setup script to ensure all services have proper environment variables
 * for centralized CORS configuration
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Import centralized configuration and React environment setup
const { PORTS } = require('../server/config');
const { generateReactEnv, createReactConfigFile } = require('./generate-react-env');

/**
 * Set environment variables for all services
 */
function setupEnvironmentVariables() {
  console.log('🔧 Setting up environment variables for CORS configuration...');
  
  // Set environment variables for all port configurations
  Object.entries(PORTS).forEach(([key, port]) => {
    const envKey = `${key}_PORT`;
    process.env[envKey] = port.toString();
    console.log(`   ${envKey}=${port}`);
  });
  
  console.log('✅ Environment variables configured');
}

/**
 * Create .env file for services that need it
 */
function createEnvFile() {
  console.log('📝 Creating .env file for port configuration...');
  
  const envContent = Object.entries(PORTS)
    .map(([key, port]) => `${key}_PORT=${port}`)
    .join('\n');
  
  const envPath = path.join(__dirname, '..', '.env');
  fs.writeFileSync(envPath, envContent + '\n');
  
  console.log(`✅ .env file created at ${envPath}`);
}

/**
 * Validate CORS configuration across all services
 */
function validateCorsConfiguration() {
  console.log('🔍 Validating CORS configuration...');
  
  const configFiles = [
    'server/config/corsConfig.js',
    'app.js',
    'video-renderer/server/src/index.ts',
    'server/tts_service/vieneu_service.py',
    'server/tts_service/omnivoice_service.py'
  ];
  
  let allValid = true;
  
  configFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
      console.log(`   ✅ ${file} - exists`);
    } else {
      console.log(`   ❌ ${file} - missing`);
      allValid = false;
    }
  });
  
  if (allValid) {
    console.log('✅ All CORS configuration files are present');
  } else {
    console.log('❌ Some CORS configuration files are missing');
    process.exit(1);
  }
}

/**
 * Display CORS configuration summary
 */
function displayCorsConfigSummary() {
  console.log('\n📋 CORS Configuration Summary:');
  console.log('=====================================');
  
  console.log('\n🌐 Allowed Origins (all services):');
  Object.entries(PORTS).forEach(([service, port]) => {
    console.log(`   • http://localhost:${port} (${service})`);
    console.log(`   • http://127.0.0.1:${port} (${service})`);
  });
  
  console.log('\n🔧 Services with CORS configuration:');
  console.log('   • Express Server (Backend) - Port', PORTS.BACKEND);
  console.log('   • Video Renderer - Port', PORTS.VIDEO_RENDERER);
  console.log('   • VieNeu-TTS Service (Flask) - Port', PORTS.NARRATION);
  console.log('   • OmniVoice Service (Flask) - Port', PORTS.CHATTERBOX);
  
  console.log('\n📝 Configuration Files:');
  console.log('   • server/config/corsConfig.js (Node.js services)');
  console.log('   • server/tts_service/*.py (local narration services)');
  
  console.log('\n🚀 To test CORS configuration:');
  console.log('   1. Start all services: npm run dev:cuda');
  console.log('   2. Check health endpoints:');
  console.log(`      • http://localhost:${PORTS.BACKEND}/api/health`);
  console.log(`      • http://localhost:${PORTS.VIDEO_RENDERER}/health`);
  console.log(`      • http://localhost:${PORTS.NARRATION}/health`);
  console.log(`      • http://localhost:${PORTS.CHATTERBOX}/health`);
}

/**
 * Main setup function
 */
function main() {
  console.log('🚀 Setting up CORS configuration for One-Click Subtitles Generator');
  console.log('====================================================================\n');
  
  try {
    setupEnvironmentVariables();
    createEnvFile();

    // Setup React environment
    console.log('\n🔧 Setting up React environment...');
    generateReactEnv();
    createReactConfigFile();
    console.log('✅ React environment setup complete');

    validateCorsConfiguration();
    displayCorsConfigSummary();

    console.log('\n✅ CORS configuration setup completed successfully!');
    console.log('   All services will now use centralized CORS configuration.');
    console.log('   React frontend will use environment variables for port configuration.');
    
  } catch (error) {
    console.error('❌ Error setting up CORS configuration:', error);
    process.exit(1);
  }
}

// Run the setup if this script is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  setupEnvironmentVariables,
  createEnvFile,
  validateCorsConfiguration,
  displayCorsConfigSummary
};
