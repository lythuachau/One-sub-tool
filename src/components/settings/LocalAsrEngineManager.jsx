import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiDownload, FiLoader, FiPlay, FiSquare, FiX } from 'react-icons/fi';
import { API_BASE_URL } from '../../config';
import { getManagedAsrEngine } from '../../config/asrEngines';
import '../../styles/settings/local-asr-engine.css';

const readJson = async (response) => response.json().catch(() => ({}));

const LocalAsrEngineManager = ({ engineId }) => {
  const { t } = useTranslation();
  const descriptor = getManagedAsrEngine(engineId);
  const serviceId = descriptor?.serviceId;
  const [engine, setEngine] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!serviceId) return;
    try {
      const [statusResponse, progressResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/engines/status`),
        fetch(`${API_BASE_URL}/engines/${serviceId}/install-progress`),
      ]);
      const statusPayload = await readJson(statusResponse);
      const progressPayload = await readJson(progressResponse);
      if (statusResponse.ok) setEngine(statusPayload.engines?.[serviceId] || null);
      if (progressResponse.ok) {
        setProgress(progressPayload);
        if (progressPayload.error && progressPayload.error !== 'Cancelled') setMessage(progressPayload.error);
      }
    } catch (error) {
      setMessage(t('settings.asrBackendUnavailable', 'ASR engine manager is not connected to the backend.'));
    }
  }, [serviceId, t]);

  useEffect(() => {
    setEngine(null);
    setProgress(null);
    setMessage('');
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runAction = async (action, method = 'POST') => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/engines/${serviceId}/${action}`, { method });
      const payload = await readJson(response);
      if (!response.ok || payload.error) throw new Error(payload.error || `Request failed (${response.status})`);
      if (action === 'install' && payload.progress) setProgress(payload.progress);
      await refresh();
    } catch (error) {
      setMessage(error.message || t('settings.asrActionFailed', 'ASR engine action failed.'));
    } finally {
      setBusy(false);
    }
  };

  if (!descriptor) return null;

  const isInstalling = !!progress?.running;
  const stateLabel = engine?.running
    ? t('settings.asrReady', 'Ready')
    : engine?.installed
      ? t('settings.asrInstalledStopped', 'Installed — stopped')
      : isInstalling
        ? t('settings.asrInstalling', 'Installing')
        : t('settings.asrNotInstalled', 'Not installed');

  return (
    <div className="asr-engine-manager" aria-live="polite">
      <div className="asr-engine-manager__summary">
        <div>
          <strong>{t('settings.asrLocalEngine', 'Local ASR model')}</strong>
          <span className={`asr-engine-manager__state ${engine?.running ? 'is-ready' : ''}`}>
            {stateLabel}
          </span>
        </div>
        {isInstalling ? (
          <button type="button" className="asr-engine-manager__button is-muted" onClick={() => runAction('install/cancel')} disabled={busy}>
            <FiX aria-hidden="true" /> {t('settings.asrCancelInstall', 'Cancel install')}
          </button>
        ) : !engine?.installed ? (
          <button type="button" className="asr-engine-manager__button" onClick={() => runAction('install')} disabled={busy || !engine}>
            {busy ? <FiLoader className="is-spinning" aria-hidden="true" /> : <FiDownload aria-hidden="true" />}
            {t('settings.asrInstall', 'Install model')}
          </button>
        ) : engine?.running ? (
          <button type="button" className="asr-engine-manager__button is-muted" onClick={() => runAction('stop')} disabled={busy}>
            <FiSquare aria-hidden="true" /> {t('settings.asrStop', 'Stop engine')}
          </button>
        ) : (
          <button type="button" className="asr-engine-manager__button" onClick={() => runAction('start')} disabled={busy}>
            {busy ? <FiLoader className="is-spinning" aria-hidden="true" /> : <FiPlay aria-hidden="true" />}
            {t('settings.asrStart', 'Start engine')}
          </button>
        )}
      </div>

      {isInstalling && (
        <div className="asr-engine-manager__progress">
          <div className="asr-engine-manager__progress-track">
            <span style={{ width: `${Math.max(0, Math.min(100, progress.percent || 0))}%` }} />
          </div>
          <span>{progress.queued
            ? t('settings.asrQueued', 'Waiting for another model installation…')
            : `${progress.percent || 0}%`}</span>
          {progress.log?.length > 0 && <small>{progress.log[progress.log.length - 1]}</small>}
        </div>
      )}

      <p className="asr-engine-manager__hint">
        {engine?.running
          ? t('settings.asrReadyHint', 'This model is ready for subtitle generation. Only one catalog ASR service is started at a time.')
          : t('settings.asrInstallHint', 'Install downloads the model and its isolated Python runtime once. Start it here before selecting it for transcription.')}
      </p>
      {message && <p className="asr-engine-manager__message" role="alert">{message}</p>}
    </div>
  );
};

export default LocalAsrEngineManager;
