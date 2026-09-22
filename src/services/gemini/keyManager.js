/**
 * Gemini API Key Manager
 * Manages multiple Gemini API keys with automatic failover
 */

// Key storage name in localStorage
const GEMINI_KEYS_STORAGE = 'gemini_api_keys';
// Current active key index storage name
const ACTIVE_KEY_INDEX_STORAGE = 'gemini_active_key_index';
// Legacy single key storage name
const LEGACY_KEY_STORAGE = 'gemini_api_key';
// Blacklist timeout in milliseconds (5 minutes)
const BLACKLIST_TIMEOUT = 5 * 60 * 1000;

const notifyKeyChange = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('gemini-api-key-changed'));
  }
};

// In-memory storage for blacklisted keys
const blacklistedKeys = new Map();

/**
 * Initialize the key manager
 * Migrates from legacy single key to multiple keys if needed
 */
export const initKeyManager = () => {
  // Check if we need to migrate from legacy single key
  const legacyKey = localStorage.getItem(LEGACY_KEY_STORAGE);
  const existingKeys = localStorage.getItem(GEMINI_KEYS_STORAGE);

  if (legacyKey && !existingKeys) {
    // Migrate the legacy key to the new format
    const keys = [legacyKey];
    localStorage.setItem(GEMINI_KEYS_STORAGE, JSON.stringify(keys));
    localStorage.setItem(ACTIVE_KEY_INDEX_STORAGE, '0');
    
    // Keep the legacy key for backward compatibility
    // We'll remove it in a future version
  }
};

/**
 * Get all stored Gemini API keys
 * @returns {Array<string>} Array of API keys
 */
export const getAllKeys = () => {
  const keysJson = localStorage.getItem(GEMINI_KEYS_STORAGE);
  if (!keysJson) {
    // If no keys in new format, check legacy format
    const legacyKey = localStorage.getItem(LEGACY_KEY_STORAGE);
    return legacyKey ? [legacyKey] : [];
  }
  
  try {
    return JSON.parse(keysJson) || [];
  } catch (error) {
    console.error('Error parsing Gemini API keys:', error);
    return [];
  }
};

/**
 * Save all Gemini API keys
 * @param {Array<string>} keys Array of API keys
 */
export const saveAllKeys = (keys) => {
  if (!Array.isArray(keys)) {
    console.error('Invalid keys format, must be an array');
    return;
  }
  
  // Filter out empty keys
  const validKeys = keys.filter(key => key && key.trim());
  
  // Save to localStorage
  localStorage.setItem(GEMINI_KEYS_STORAGE, JSON.stringify(validKeys));
  
  // Update legacy key for backward compatibility
  if (validKeys.length > 0) {
    const activeIndex = getActiveKeyIndex();
    const activeKey = validKeys[activeIndex < validKeys.length ? activeIndex : 0];
    localStorage.setItem(LEGACY_KEY_STORAGE, activeKey);
  } else {
    localStorage.removeItem(LEGACY_KEY_STORAGE);
  }
  
  // Reset active key index if needed
  const currentIndex = getActiveKeyIndex();
  if (currentIndex >= validKeys.length && validKeys.length > 0) {
    setActiveKeyIndex(0);
  }

  notifyKeyChange();
};

/**
 * Add a new Gemini API key
 * @param {string} key API key to add
 * @returns {boolean} True if key was added, false if it already exists
 */
export const addKey = (key) => {
  if (!key || !key.trim()) {
    return false;
  }
  
  const keys = getAllKeys();
  if (keys.includes(key)) {
    return false;
  }
  
  keys.push(key);
  saveAllKeys(keys);
  return true;
};

/**
 * Remove a Gemini API key
 * @param {string} key API key to remove
 * @returns {boolean} True if key was removed, false if it doesn't exist
 */
export const removeKey = (key) => {
  const keys = getAllKeys();
  const index = keys.indexOf(key);
  
  if (index === -1) {
    return false;
  }
  
  keys.splice(index, 1);
  saveAllKeys(keys);
  
  // If we removed the active key, update the active index
  const activeIndex = getActiveKeyIndex();
  if (activeIndex === index) {
    setActiveKeyIndex(0);
  } else if (activeIndex > index) {
    // If we removed a key before the active key, decrement the active index
    setActiveKeyIndex(activeIndex - 1);
  }
  
  return true;
};

/**
 * Get the active key index
 * @returns {number} Active key index
 */
export const getActiveKeyIndex = () => {
  const indexStr = localStorage.getItem(ACTIVE_KEY_INDEX_STORAGE);
  const index = parseInt(indexStr, 10);
  return isNaN(index) ? 0 : index;
};

/**
 * Set the active key index
 * @param {number} index New active key index
 */
export const setActiveKeyIndex = (index) => {
  localStorage.setItem(ACTIVE_KEY_INDEX_STORAGE, index.toString());
  
  // Update legacy key for backward compatibility
  const keys = getAllKeys();
  if (keys.length > 0 && index < keys.length) {
    localStorage.setItem(LEGACY_KEY_STORAGE, keys[index]);
    notifyKeyChange();
  }
};

/**
 * Get the current active API key
 * @returns {string|null} Current active API key or null if no keys
 */
export const getCurrentKey = () => {
  const keys = getAllKeys();
  if (keys.length === 0) {
    return null;
  }
  
  const activeIndex = getActiveKeyIndex();
  return keys[activeIndex < keys.length ? activeIndex : 0];
};

/**
 * Blacklist a key temporarily due to an error
 * @param {string} key API key to blacklist
 */
export const blacklistKey = (key) => {
  if (!key) return;
  
  blacklistedKeys.set(key, Date.now() + BLACKLIST_TIMEOUT);
  console.warn(`Blacklisted Gemini API key for ${BLACKLIST_TIMEOUT/1000} seconds`);
  
  // If this was the active key, rotate to the next one
  if (key === getCurrentKey()) {
    rotateToNextKey();
  }
};

/**
 * Check if a key is blacklisted
 * @param {string} key API key to check
 * @returns {boolean} True if key is blacklisted
 */
export const isKeyBlacklisted = (key) => {
  if (!key || !blacklistedKeys.has(key)) {
    return false;
  }
  
  const expiryTime = blacklistedKeys.get(key);
  if (Date.now() > expiryTime) {
    // Blacklist period expired, remove from blacklist
    blacklistedKeys.delete(key);
    return false;
  }
  
  return true;
};

/**
 * Rotate to the next available API key
 * @returns {string|null} New active API key or null if no keys available
 */
export const rotateToNextKey = () => {
  const keys = getAllKeys();
  if (keys.length <= 1) {
    return getCurrentKey();
  }
  
  const currentIndex = getActiveKeyIndex();
  let newIndex = (currentIndex + 1) % keys.length;
  let attempts = 0;
  
  // Try to find a non-blacklisted key
  while (isKeyBlacklisted(keys[newIndex]) && attempts < keys.length) {
    newIndex = (newIndex + 1) % keys.length;
    attempts++;
  }
  
  // If all keys are blacklisted, use the first one anyway
  if (attempts >= keys.length) {
    newIndex = 0;
    // Clear all blacklisted keys if we've gone through all of them
    blacklistedKeys.clear();
  }
  
  setActiveKeyIndex(newIndex);
  return keys[newIndex];
};

/**
 * Get the next available API key that isn't blacklisted
 * @returns {string|null} Next available API key or null if no keys available
 */
export const getNextAvailableKey = () => {
  const keys = getAllKeys();
  if (keys.length === 0) {
    return null;
  }
  
  // First try the current key
  const currentKey = getCurrentKey();
  if (currentKey && !isKeyBlacklisted(currentKey)) {
    return currentKey;
  }
  
  // If current key is blacklisted, rotate to next
  return rotateToNextKey();
};

// Initialize the key manager when this module is imported
initKeyManager();
