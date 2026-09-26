/**
 * Frontend startup script with process tracking
 */

const { spawn } = require('child_process');
const path = require('path');

// Import port management
const { trackProcess } = require('../server/utils/portManager');
const { PORTS } = require('../server/config');
const { markStartupPhase } = require('../server/utils/startupMetrics');

console.log('🚀 Starting React frontend...');
markStartupPhase('frontend_starting', { mode: 'development', port: PORTS.FRONTEND });

// Set the port environment variable
process.env.PORT = PORTS.FRONTEND.toString();

// Start the React development server
const reactProcess = spawn('npm', ['run', 'start-react'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PORT: PORTS.FRONTEND.toString()
  }
});

// Track the React process
if (reactProcess.pid) {
  trackProcess(PORTS.FRONTEND, reactProcess.pid, 'React Frontend');
  markStartupPhase('frontend_process_spawned', { pid: reactProcess.pid });
}

const waitForFrontend = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORTS.FRONTEND}/`);
      if (response.ok) {
        markStartupPhase('frontend_ready', { port: PORTS.FRONTEND });
        return;
      }
    } catch (error) {
      // The development server is still compiling.
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.warn('⚠️ Frontend did not become reachable within 120 seconds');
};

void waitForFrontend();

// Handle process events
reactProcess.on('error', (error) => {
  console.error('❌ Failed to start React frontend:', error);
  process.exit(1);
});

reactProcess.on('close', (code) => {
  console.log(`React frontend exited with code ${code}`);
  process.exit(code);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down React frontend...');
  reactProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down React frontend...');
  reactProcess.kill('SIGTERM');
});
