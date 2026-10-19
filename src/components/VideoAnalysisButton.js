import React, { useEffect, useRef, useState } from 'react';
import { FiEdit2, FiX, FiZap } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import TranscriptionRulesEditor from './TranscriptionRulesEditor';
import { analyzeVideoAndWaitForUserChoice } from '../utils/videoProcessing/analysisUtils';
import { clearTranscriptionRules, getTranscriptionRulesSync, setTranscriptionRules } from '../utils/transcriptionRulesStore';

const getVideoFingerprint = (file, selectedVideo) => {
  if (file) return `${file.name}_${file.size}_${file.lastModified || ''}`;
  return selectedVideo?.url || selectedVideo?.id || null;
};

const clearAnalysisSession = () => {
  sessionStorage.removeItem('current_session_preset_id');
  sessionStorage.removeItem('last_applied_recommendation');
  sessionStorage.removeItem('current_session_video_fingerprint');
  sessionStorage.removeItem('current_session_prompt');
};

const VideoAnalysisButton = ({ disabled = false, uploadedFile = null, selectedVideo = null, hasVideoSource = false, apiKeysSet, setStatus, onAnalyzeSelectedSource }) => {
  const { t } = useTranslation();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [showRulesEditor, setShowRulesEditor] = useState(false);
  const [transcriptionRules, setTranscriptionRulesState] = useState(null);
  const lastVideoFingerprint = useRef(null);

  useEffect(() => {
    const currentFingerprint = getVideoFingerprint(
      uploadedFile || (!selectedVideo && (window.uploadedVideoFile || window.downloadedVideoFile)),
      selectedVideo
    );
    const previousFingerprint = lastVideoFingerprint.current;
    if (currentFingerprint === previousFingerprint) return;
    lastVideoFingerprint.current = currentFingerprint;

    if (previousFingerprint && previousFingerprint !== currentFingerprint) {
      clearAnalysisSession();
      clearTranscriptionRules().catch((error) => console.error('Error clearing video analysis rules:', error));
      setHasAnalysis(false);
      setTranscriptionRulesState(null);
      setShowRulesEditor(false);
      return;
    }

    const rules = getTranscriptionRulesSync();
    setHasAnalysis(!!rules);
    setTranscriptionRulesState(rules);
  }, [uploadedFile, selectedVideo]);

  useEffect(() => {
    const handleAnalysisComplete = (event) => {
      const rules = event.detail?.transcriptionRules;
      if (rules) {
        setHasAnalysis(true);
        setTranscriptionRulesState(rules);
      }
    };
    const handleRulesUpdated = (event) => {
      const rules = event.detail?.rules;
      setHasAnalysis(!!rules);
      setTranscriptionRulesState(rules || null);
    };

    window.addEventListener('videoAnalysisComplete', handleAnalysisComplete);
    window.addEventListener('transcriptionRulesUpdated', handleRulesUpdated);
    return () => {
      window.removeEventListener('videoAnalysisComplete', handleAnalysisComplete);
      window.removeEventListener('transcriptionRulesUpdated', handleRulesUpdated);
    };
  }, []);

  const getCurrentVideoFile = () => uploadedFile || (!selectedVideo && (window.uploadedVideoFile || window.downloadedVideoFile)) || null;

  const handleAnalyzeVideo = async () => {
    if (!apiKeysSet?.gemini) {
      setStatus?.({ message: t('errors.apiKeyRequired', 'Gemini API key is required'), type: 'error' });
      return;
    }

    const videoFile = getCurrentVideoFile();
    if ((!videoFile && !(hasVideoSource && onAnalyzeSelectedSource)) || (videoFile && !videoFile.type?.startsWith('video/'))) {
      setStatus?.({ message: t('videoAnalysis.noVideoFile', 'No local video is ready. Upload or download a video first.'), type: 'warning' });
      return;
    }

    clearAnalysisSession();
    sessionStorage.setItem('force_video_analysis_modal', 'true');
    setIsAnalyzing(true);
    try {
      if (videoFile) {
        const result = await analyzeVideoAndWaitForUserChoice(videoFile, () => {}, t);
        const rules = result?.userChoice?.transcriptionRules || result?.analysisResult?.transcriptionRules || getTranscriptionRulesSync();
        setTranscriptionRulesState(rules || null);
        setHasAnalysis(!!rules);
      } else {
        await onAnalyzeSelectedSource();
        const rules = getTranscriptionRulesSync();
        setTranscriptionRulesState(rules || null);
        setHasAnalysis(!!rules);
      }
    } catch (error) {
      console.error('Video analysis failed:', error);
      setStatus?.({ message: t('videoAnalysis.error', 'Video analysis failed: {{message}}', { message: error.message }), type: 'error' });
    } finally {
      sessionStorage.removeItem('force_video_analysis_modal');
      setIsAnalyzing(false);
    }
  };

  const handleSaveRules = async (rules) => {
    await setTranscriptionRules(rules);
    setTranscriptionRulesState(rules);
    setHasAnalysis(!!rules);
    setShowRulesEditor(false);
  };

  const handleClearAnalysis = async () => {
    await clearTranscriptionRules();
    clearAnalysisSession();
    setHasAnalysis(false);
    setTranscriptionRulesState(null);
  };

  const handlePrimaryAction = hasAnalysis ? () => setShowRulesEditor(true) : handleAnalyzeVideo;

  return (
    <>
      <div className="video-analysis-buttons-group">
        <button
          className={`video-analysis-button ${hasAnalysis ? 'has-analysis' : ''}`}
          onClick={handlePrimaryAction}
          disabled={disabled || isAnalyzing}
          title={hasAnalysis ? t('videoAnalysis.editTooltip', 'Edit transcription rules') : t('videoAnalysis.analyzeTooltip', 'Analyze video and create transcription rules')}
        >
          {isAnalyzing ? (
            <span className="processing-text-container">
              <span className="video-analysis-spinner" aria-hidden="true" />
              <span>{t('videoAnalysis.analyzing', 'Analyzing...')}</span>
            </span>
          ) : (
            <>
              {hasAnalysis
                ? <FiEdit2 className="video-analysis-icon" aria-hidden="true" />
                : <FiZap className="video-analysis-icon" aria-hidden="true" />}
              <span className="video-analysis-label">{hasAnalysis ? t('videoAnalysis.editRules', 'Edit rules') : t('videoAnalysis.addAnalysis', 'Add analysis')}</span>
            </>
          )}
        </button>
        {hasAnalysis && (
          <button
            className="clear-analysis-button"
            onClick={handleClearAnalysis}
            disabled={disabled || isAnalyzing}
            aria-label={t('videoAnalysis.clearAnalysis', 'Clear video analysis')}
            title={t('videoAnalysis.clearAnalysis', 'Clear video analysis')}
          >
            <FiX aria-hidden="true" />
          </button>
        )}
      </div>
      {showRulesEditor && (
        <TranscriptionRulesEditor
          isOpen={showRulesEditor}
          onClose={() => setShowRulesEditor(false)}
          initialRules={transcriptionRules}
          onSave={handleSaveRules}
          onCancel={() => setShowRulesEditor(false)}
        />
      )}
    </>
  );
};

export default VideoAnalysisButton;
