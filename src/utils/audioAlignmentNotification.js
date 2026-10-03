/**
 * Audio Alignment Notification Utility
 * Shows popup notifications when aligned audio duration exceeds expected duration significantly
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import LiquidGlass from '../components/common/LiquidGlass.js';
import i18n from '../i18n/i18n.js';

/**
 * Show audio alignment warning notification using LiquidGlass styling
 * @param {number} durationDifference - Difference in seconds between actual and expected duration
 */
export const showAudioAlignmentWarning = (durationDifference) => {
  console.log(`🚨 showAudioAlignmentWarning called with duration difference: ${durationDifference}s`);

  // Only show notification if difference is larger than 3 seconds
  if (durationDifference <= 3) {
    console.log(`⏹️ Duration difference ${durationDifference}s <= 3s, not showing notification`);
    return;
  }

  console.log(`🔄 Removing any existing notification...`);
  // Remove any existing notification
  const existingNotification = document.querySelector('.audio-alignment-warning-container');
  if (existingNotification) {
    console.log(`🗑️ Found existing notification, removing it`);
    existingNotification.remove();
  }

  console.log(`📦 Creating notification container...`);
  // Create container element
  const container = document.createElement('div');
  container.className = 'audio-alignment-warning-container';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    pointer-events: auto;
  `;

  console.log(`🌐 Getting translated messages...`);
  // Get translated message
  const message = i18n.t('narration.audioAlignmentWarning', {
    duration: durationDifference.toFixed(1)
  });
  const closeLabel = i18n.t('narration.closeNotification');
  console.log(`📝 Message: "${message}", Close label: "${closeLabel}"`);

  // Create React component for the notification using LiquidGlass with added blur
  const NotificationComponent = () => (
    <LiquidGlass
      width={600}
      height={120}
      position="relative"
      borderRadius="32px"
      backdropFilter="blur(2px) contrast(1.2) brightness(1.05) saturate(1.1)"
      className="content-center theme-warning"
      style={{
        cursor: 'default',
        zIndex: 10,
        transition: 'opacity 0.6s ease-in-out',
        opacity: 1,
        pointerEvents: 'auto'
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: '16px',
        width: '100%',
        height: '100%',
        padding: '0 20px',
        color: 'white'
      }}>
        {/* Warning SVG icon */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            flexShrink: 0,
            fill: 'var(--md-on-surface, #000)',
            filter: document.documentElement.getAttribute('data-theme') === 'dark'
              ? 'drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.8))'
              : 'drop-shadow(1px 1px 2px rgba(255, 255, 255, 0.8))'
          }}
        >
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
        </svg>

        {/* Message text */}
        <div style={{
          flex: 1,
          fontSize: '14px',
          fontWeight: '500',
          lineHeight: '1.4',
          textAlign: 'left',
          color: 'var(--md-on-surface, #000)',
          textShadow: document.documentElement.getAttribute('data-theme') === 'dark'
            ? '1px 1px 2px rgba(0, 0, 0, 0.8)'
            : '1px 1px 2px rgba(255, 255, 255, 0.8)'
        }}>
          {message}
        </div>

        {/* Close button */}
        <button
          onClick={() => container.remove()}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--md-on-surface, #000)',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '8px',
            transition: 'background-color 0.2s ease',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px'
          }}
          onMouseEnter={(e) => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            e.target.style.backgroundColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = 'transparent';
          }}
          aria-label={closeLabel}
          title={closeLabel}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            style={{
              fill: 'var(--md-on-surface, #000)',
              filter: document.documentElement.getAttribute('data-theme') === 'dark'
                ? 'drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.8))'
                : 'drop-shadow(1px 1px 2px rgba(255, 255, 255, 0.8))'
            }}
          >
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    </LiquidGlass>
  );

  console.log(`🔗 Adding container to document body...`);
  // Add to document
  document.body.appendChild(container);

  console.log(`⚛️ Creating React root and rendering notification...`);
  // Render React component
  const root = ReactDOM.createRoot(container);
  root.render(<NotificationComponent />);

  console.log(`⏰ Setting up auto-remove timer (30 seconds)...`);
  // Auto-remove after 30 seconds as a fallback (in case user doesn't close it)
  setTimeout(() => {
    if (container.parentNode) {
      console.log(`🗑️ Auto-removing notification after 30 seconds`);
      container.remove();
    }
  }, 30000);

  console.log(`✅ Audio alignment warning shown: ${durationDifference.toFixed(1)}s difference`);
  console.log(`📍 Container added to DOM with class: ${container.className}`);
  console.log(`🎯 Container position: fixed, bottom: 20px, z-index: 9999`);
};

/**
 * Check response headers for duration information and show notification if needed
 * @param {Response} response - Fetch response object
 */
export const checkAudioAlignmentFromResponse = (response) => {
  try {
    console.log('🔍 Checking audio alignment from response headers...');
    console.log('📋 Available headers:', Array.from(response.headers.entries()));

    const durationDifference = parseFloat(response.headers.get('X-Duration-Difference'));
    const expectedDuration = parseFloat(response.headers.get('X-Expected-Duration'));
    const actualDuration = parseFloat(response.headers.get('X-Actual-Duration'));
    const optimizedCount = parseInt(response.headers.get('X-TTS-Optimized-Count') || '0', 10);
    const optimizationAttempts = parseInt(response.headers.get('X-TTS-Optimization-Attempts') || '0', 10);

    console.log(`📊 Audio alignment check: Expected ${expectedDuration}s, Actual ${actualDuration}s, Difference ${durationDifference}s`);
    console.log(`🧠 TTS optimization: optimized ${optimizedCount} segment(s) in ${optimizationAttempts} attempt(s)`);
    console.log(`🔢 Header values - Duration Diff: "${response.headers.get('X-Duration-Difference')}", Expected: "${response.headers.get('X-Expected-Duration')}", Actual: "${response.headers.get('X-Actual-Duration')}"`);

    if (!isNaN(durationDifference) && durationDifference > 3) {
      console.log(`⚠️ Duration difference ${durationDifference}s > 3s, showing notification...`);
      showAudioAlignmentWarning(durationDifference);
    } else {
      console.log(`✅ Duration difference ${durationDifference}s <= 3s or invalid, no notification needed`);
    }
  } catch (error) {
    console.error('❌ Error checking audio alignment from response:', error);
  }
};

/**
 * Initialize audio alignment notification system
 * This should be called once when the app starts
 */
export const initializeAudioAlignmentNotifications = () => {
  // No additional initialization needed since we're using React components
  console.log('Audio alignment notification system initialized');
};
