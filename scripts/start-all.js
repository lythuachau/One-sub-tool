/**
 * Comprehensive startup script for all services
 * Handles port cleanup and process tracking
 */

const { spawn } = require('child_process');
const path = require('path');

// Import port management and CORS setup
const { killProcessesOnPorts, cleanupTrackingFile } = require('../server/utils/portManager');
const { setupEnvironmentVariables } = require('./setup-cors-env');
const { markStartupPhase } = require('../server/utils/startupMetrics');

async function startAllServices() {
  process.env.STARTUP_EPOCH_MS = process.env.STARTUP_EPOCH_MS || String(Date.now());
  markStartupPhase('launcher_started');
  console.log('🚀 Starting One-Click Subtitles Generator...');

  // Setup CORS environment variables
  setupEnvironmentVariables();
  markStartupPhase('environment_ready');
  
  try {
    // Clean up old processes and tracking
    console.log('🧹 Cleaning up previous processes...');
    cleanupTrackingFile();
    await killProcessesOnPorts();
    markStartupPhase('ports_cleaned');
    
    console.log('✅ Cleanup complete, starting services...');
    
    // Start all services using concurrently with proper command escaping
    const frontendCommand = process.env.FRONTEND_MODE === 'production'
      ? 'npm run start:prod --silent'
      : 'npm run start --silent';
    const concurrentlyArgs = [
      '--names', 'FRONTEND,SERVER',
      '--prefix-colors', 'cyan,green',
      '--prefix', '[{name}]',
      frontendCommand,
      'npm run server:start'
    ];

    const concurrentlyScript = path.join(
      __dirname,
      '..',
      'node_modules',
      'concurrently',
      'dist',
      'bin',
      'concurrently.js'
    );

    console.log('🚀 Starting services with command:', process.execPath, concurrentlyScript, concurrentlyArgs.join(' '));

    const concurrentlyProcess = spawn(process.execPath, [concurrentlyScript, ...concurrentlyArgs], {
      stdio: 'inherit',
      env: {
        ...process.env,
        START_PYTHON_SERVER: 'true',
        DEV_SERVER_MANAGED: 'true',
        STARTUP_EPOCH_MS: process.env.STARTUP_EPOCH_MS
      }
    });
    markStartupPhase('service_supervisor_started', { mode: process.env.FRONTEND_MODE || 'development' });

    // Handle process events
    concurrentlyProcess.on('error', (error) => {
      console.error('❌ Failed to start services:', error);
      process.exit(1);
    });

    concurrentlyProcess.on('close', (code) => {
      console.log(`Services exited with code ${code}`);
      process.exit(code);
    });

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down all services...');
      concurrentlyProcess.kill('SIGINT');
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Shutting down all services...');
      concurrentlyProcess.kill('SIGTERM');
    });

  } catch (error) {
    console.error('❌ Error during startup:', error);
    process.exit(1);
  }
}

// Start all services
startAllServices();
