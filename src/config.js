/**
 * Frontend configuration
 */

const DEFAULT_FRONTEND_PORT = 3030;
const DEFAULT_BACKEND_PORT = 3031;

const readPort = (value, fallback) => {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
};

const configuredFrontendPort = readPort(process.env.REACT_APP_FRONTEND_PORT, DEFAULT_FRONTEND_PORT);
const configuredBackendPort = readPort(process.env.REACT_APP_BACKEND_PORT, DEFAULT_BACKEND_PORT);
const runtimeFrontendPort = typeof window !== 'undefined'
  ? readPort(window.location.port, configuredFrontendPort)
  : configuredFrontendPort;
const isLoopbackHost = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const runtimePortOffset = runtimeFrontendPort - configuredFrontendPort;
const backendPort = isLoopbackHost && runtimePortOffset !== 0
  ? configuredBackendPort + runtimePortOffset
  : configuredBackendPort;
const configuredBackendUrl = process.env.REACT_APP_BACKEND_URL;
const BACKEND_URL = configuredBackendUrl || `http://127.0.0.1:${backendPort}`;

// API base URL for server requests - using IPv4 for better compatibility
export const API_BASE_URL = `${BACKEND_URL.replace(/\/$/, '')}/api`;

// Server URL for direct server requests (without /api) - using IPv4 for better compatibility
export const SERVER_URL = BACKEND_URL.replace(/\/$/, '');

// Gemini API key for direct API calls
// This should be loaded from environment variables in production
export const GEMINI_API_KEY = localStorage.getItem('gemini_api_key') || '';

// Default Gemini model for transcription
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
