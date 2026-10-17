import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FiVideo, FiMusic, FiDownload, FiInfo } from 'react-icons/fi';
import CloseButton from './common/CloseButton';
import '../styles/DownloadOnlyModal.css';
import { scanVideoQualities } from '../utils/qualityScanner';

// Global singleton to prevent multiple download modals
let activeDownloadModal = null;

const DownloadOnlyModal = ({
  isOpen,
  onClose,
  videoInfo
}) => {
  const { t } = useTranslation();
  const [selectedType, setSelectedType] = useState(''); // 'video' or 'audio' - no preselection
  const [selectedQuality, setSelectedQuality] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [availableQualities, setAvailableQualities] = useState([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [downloadVideoId, setDownloadVideoId] = useState(null);

  // Get current cookie setting as state
  const [useCookiesEnabled, setUseCookiesEnabled] = useState(
    localStorage.getItem('use_cookies_for_download') === 'true'
  );

  // Prevent multiple modal instances
  useEffect(() => {
    if (isOpen) {
      if (activeDownloadModal && activeDownloadModal !== onClose) {
        console.log('[DownloadOnlyModal] Another modal is already active, closing this one');
        onClose();
        return;
      }
      activeDownloadModal = onClose;
      console.log('[DownloadOnlyModal] Registered as active modal');
    }

    return () => {
      if (activeDownloadModal === onClose) {
        activeDownloadModal = null;
        console.log('[DownloadOnlyModal] Unregistered active modal');
      }
    };
  }, [isOpen, onClose]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSelectedType(''); // Don't preselect any type
      setSelectedQuality(null);
      setAvailableQualities([]);
      setIsScanning(false);
      setIsDownloading(false);
      setDownloadProgress(0);
      setDownloadError('');
      setDownloadVideoId(null);
    }
  }, [isOpen]);

  // Scan qualities when video type is selected (only when user actively selects video)
  useEffect(() => {
    if (selectedType === 'video' && videoInfo?.url && availableQualities.length === 0 && !isScanning) {
      handleScanQualities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, videoInfo?.url]);

  // Listen for changes to cookie setting and update when modal opens
  useEffect(() => {
    if (isOpen) {
      // Update cookie setting when modal opens
      setUseCookiesEnabled(localStorage.getItem('use_cookies_for_download') === 'true');
    }

    const handleStorageChange = () => {
      setUseCookiesEnabled(localStorage.getItem('use_cookies_for_download') === 'true');
    };

    const handleFocus = () => {
      // Update when window regains focus (e.g., after closing settings modal)
      setUseCookiesEnabled(localStorage.getItem('use_cookies_for_download') === 'true');
    };

    // Listen for storage events (when localStorage changes in other tabs/windows)
    window.addEventListener('storage', handleStorageChange);
    // Listen for focus events (when user returns to tab/window)
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isOpen]);

  const handleScanQualities = async () => {
    if (!videoInfo?.url) return;

    setIsScanning(true);
    try {
      const qualities = await scanVideoQualities(videoInfo.url);
      setAvailableQualities(qualities);
      
      // Auto-select 360p if available, otherwise select the first quality
      const preferred360p = qualities.find(q => q.quality === '360p');
      if (preferred360p) {
        setSelectedQuality(preferred360p);
      } else if (qualities.length > 0) {
        setSelectedQuality(qualities[0]);
      }
    } catch (error) {
      console.error('Error scanning qualities:', error);
      setAvailableQualities([]);
    } finally {
      setIsScanning(false);
    }
  };

  const handleDownload = async () => {
    if (!videoInfo?.url) return;

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadError('');

    try {
      const downloadData = {
        url: videoInfo.url,
        type: selectedType,
        quality: selectedType === 'video' ? selectedQuality?.quality : null,
        source: videoInfo.source,
        useCookies: localStorage.getItem('use_cookies_for_download') === 'true'
      };

      const response = await fetch('http://localhost:3031/api/download-only', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(downloadData),
      });

      const result = await response.json();

      if (result.success) {
        const videoId = result.videoId;
        setDownloadVideoId(videoId);

        // TEMPORARILY DISABLE WEBSOCKET - Use polling instead to prevent duplicates
        console.log('[DownloadOnlyModal] Using polling instead of WebSocket to prevent duplicates');
        pollDownloadProgress(videoId);
      } else {
        throw new Error(result.error || 'Download failed');
      }
    } catch (error) {
      console.error('Error starting download:', error);
      setDownloadError(error.message || 'Failed to start download');
      setIsDownloading(false);
    }
  };

  const pollDownloadProgress = (videoId) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:3031/api/download-only-progress/${videoId}`);
        const data = await response.json();

        if (data.success) {
          setDownloadProgress(data.progress || 0);

          if (data.status === 'completed' || data.status === 'error') {
            clearInterval(interval);
            setIsDownloading(false);

            if (data.status === 'error') {
              setDownloadError(data.error || 'Video download failed. Check the server log for details.');
            }
            
            if (data.status === 'completed') {
              // Trigger download using the download endpoint
              const downloadUrl = `http://localhost:3031/api/download-only-file/${videoId}`;
              const a = document.createElement('a');
              a.href = downloadUrl;
              a.download = `download.${selectedType === 'video' ? 'mp4' : 'mp3'}`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              onClose();
            }
          }
        }
      } catch (error) {
        console.error('Error polling download progress:', error);
      }
    }, 1000);
  };

  const handleClose = () => {
    if (!isDownloading) {
      onClose();
    }
  };

  const canDownload = () => {
    if (!selectedType) return false; // No type selected
    if (selectedType === 'audio') return true;
    if (selectedType === 'video') return selectedQuality !== null;
    return false;
  };

  if (!isOpen) return null;

  // Create portal content to render at root level
  const modalContent = (
    <div className="download-only-modal-overlay" onClick={handleClose}>
      <div className="download-only-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="header-content">
            <h3>{t('download.downloadOnly.title', 'Download Media')}</h3>
            <div className={`header-badge ${useCookiesEnabled ? 'cookie-enabled' : 'cookie-disabled'}`}
                 title={useCookiesEnabled
                   ? t('download.downloadOnly.cookieSupportTooltip', 'Uses browser cookies for authentication to access higher quality videos and bypass login restrictions')
                   : t('download.downloadOnly.cookieDisabledTooltip', 'Browser cookies are disabled. Downloads will be faster but may have limited quality options and fail on restricted content.')
                 }>
              <FiInfo className="badge-icon" />
              <span className="badge-text">
                {useCookiesEnabled
                  ? t('download.downloadOnly.cookieSupport', 'Browser Cookie Added')
                  : t('download.downloadOnly.cookieDisabled', 'Browser Cookie Disabled')
                }
              </span>
            </div>
          </div>
          <CloseButton
            onClick={handleClose}
            disabled={isDownloading}
            variant="modal"
            size="medium"
          />
        </div>

        {/* Content */}
        <div className="modal-content">
          {/* Download Type Selection */}
          <div className="download-options">
            {/* Type Options Row */}
            <div className="type-options-row">
              {/* Video Option */}
              <label className="option-item">
                <input
                  type="radio"
                  name="download-type"
                  value="video"
                  checked={selectedType === 'video'}
                  onChange={(e) => setSelectedType(e.target.value)}
                  disabled={isDownloading}
                />
                <div className="option-content">
                  <div className="option-title">
                    <FiVideo size={16} />
                    {t('download.downloadOnly.video', 'Video')}
                  </div>
                  <div className="option-description">
                    {t('download.downloadOnly.videoDesc', 'Download video with selected quality')}
                  </div>
                </div>
              </label>

              {/* Audio Option */}
              <label className="option-item">
                <input
                  type="radio"
                  name="download-type"
                  value="audio"
                  checked={selectedType === 'audio'}
                  onChange={(e) => setSelectedType(e.target.value)}
                  disabled={isDownloading}
                />
                <div className="option-content">
                  <div className="option-title">
                    <FiMusic size={16} />
                    {t('download.downloadOnly.audio', 'Audio')}
                  </div>
                  <div className="option-description">
                    {t('download.downloadOnly.audioDesc', 'Download audio only (MP3 format)')}
                  </div>
                </div>
              </label>
            </div>

            {/* Quality Selector for Video - Outside the grid */}
            {selectedType === 'video' && (
              <div className="quality-selector">
                {isScanning ? (
                  <div className="scanning-indicator">
                    {t('download.downloadOnly.scanningQualities', 'Scanning available qualities...')}
                  </div>
                ) : availableQualities.length > 0 ? (
                  <div className="quality-options-list">
                    <div className="quality-selector-title">
                      {t('download.downloadOnly.selectQuality', 'Select quality:')}
                    </div>
                    {availableQualities.map((quality, index) => (
                      <div key={index} className="radio-pill">
                        <input
                          type="radio"
                          id={`quality-${index}`}
                          name="quality"
                          checked={selectedQuality?.quality === quality.quality}
                          onChange={() => setSelectedQuality(quality)}
                          disabled={isDownloading}
                        />
                        <label htmlFor={`quality-${index}`} className="quality-pill-label">
                          {quality.label || quality.description || quality.quality}
                        </label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-qualities">
                    {t('download.downloadOnly.noQualities', 'No qualities available')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {downloadError && (
          <div className="download-error-message" role="alert">
            {downloadError}
          </div>
        )}

        {/* Footer */}
        <div className="modal-actions">
          <button
            className="cancel-button"
            onClick={handleClose}
            disabled={isDownloading}
          >
            {t('download.downloadOnly.cancel', 'Cancel')}
          </button>
          <button
            className="confirm-button"
            onClick={handleDownload}
            disabled={!canDownload() || isDownloading}
          >
            <FiDownload size={16} />
            {isDownloading ?
              `${t('download.downloadOnly.downloading', 'Downloading...')} ${downloadProgress}%` :
              t('download.downloadOnly.download', 'Download')
            }
          </button>
        </div>
      </div>
    </div>
  );

  // Use ReactDOM.createPortal to render the modal directly to the document body
  return ReactDOM.createPortal(
    modalContent,
    document.body
  );
};

export default DownloadOnlyModal;
