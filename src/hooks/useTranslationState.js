import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { translateSubtitles, /* abortAllRequests, */ cancelTranslation, setProcessingForceStopped, getProcessingForceStopped } from '../services/geminiService';

// Constants for localStorage keys
const TRANSLATION_CACHE_KEY = 'translated_subtitles_cache';
const CURRENT_VIDEO_ID_KEY = 'current_video_url';
const CURRENT_FILE_ID_KEY = 'current_file_cache_id';

/**
 * Helper function to generate a hash for subtitles to use as a cache key
 * @param {Array} subtitles - Array of subtitle objects
 * @returns {string} - Hash string
 */
const generateSubtitleHash = (subtitles) => {
  if (!subtitles || !subtitles.length) return '';

  // Create a string representation of the subtitles (just IDs and text)
  const subtitleString = subtitles.map(s => `${s.id || s.subtitle_id || ''}:${s.text}`).join('|');

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < subtitleString.length; i++) {
    const char = subtitleString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return hash.toString(16);
};

/**
 * Helper function to get the current video/file identifier
 * @returns {string|null} - Current video/file ID or null if not found
 */
const getCurrentMediaId = () => {
  // Check for YouTube URL first
  const youtubeUrl = localStorage.getItem(CURRENT_VIDEO_ID_KEY);
  if (youtubeUrl) {
    // Extract video ID from URL
    const match = youtubeUrl.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/);
    return match ? match[1] : null;
  }

  // Check for file cache ID
  return localStorage.getItem(CURRENT_FILE_ID_KEY);
};

/**
 * Custom hook to manage translation state
 * @param {Array} subtitles - Subtitles to translate
 * @param {Function} onTranslationComplete - Callback when translation is complete
 * @returns {Object} - Translation state and handlers
 */
export const useTranslationState = (subtitles, onTranslationComplete) => {
  const { t } = useTranslation();
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedSubtitles, setTranslatedSubtitles] = useState(null);
  const [error, setError] = useState('');
  const [translationStatus, setTranslationStatus] = useState('');
  const [loadedFromCache, setLoadedFromCache] = useState(false);
  const [wasManuallyReset, setWasManuallyReset] = useState(false);

  // Bulk translation state
  const [bulkFiles, setBulkFiles] = useState([]);
  const [bulkTranslations, setBulkTranslations] = useState([]);
  const [isBulkTranslating, setIsBulkTranslating] = useState(false);
  const [currentBulkFileIndex, setCurrentBulkFileIndex] = useState(-1);


  // Use a translation-specific model selection that's independent from settings
  const [selectedModel, setSelectedModel] = useState(() => {
    // Get the model from translation-specific localStorage key or use the global setting as default
    return localStorage.getItem('translation_model') || localStorage.getItem('gemini_model') || 'gemini-flash-latest';
  });
  const [customTranslationPrompt, setCustomTranslationPrompt] = useState(
    localStorage.getItem('custom_prompt_translation') || null
  );
  const [splitDuration, setSplitDuration] = useState(() => {
    // Get the split duration from localStorage or use default (0 = no split)
    return parseInt(localStorage.getItem('translation_split_duration') || '0');
  });
  const [restTime, setRestTime] = useState(() => {
    // Get the rest time from localStorage or use default (0 = no rest)
    return parseInt(localStorage.getItem('translation_rest_time') || '0');
  });
  const [includeRules, setIncludeRules] = useState(() => {
    // Get the preference from localStorage, but default to false
    // It will be updated to true only if rules are available
    return localStorage.getItem('translation_include_rules') === 'true';
  });
  const [rulesAvailable, setRulesAvailable] = useState(false);
  const [userProvidedSubtitles, setUserProvidedSubtitles] = useState('');
  const hasUserProvidedSubtitles = userProvidedSubtitles.trim() !== '';

  // Reference to the status message element for scrolling
  const statusRef = useRef(null);

  // No longer update selectedModel when localStorage changes
  // This keeps the translation model independent from the settings

  // Listen for translation status updates
  useEffect(() => {
    const handleTranslationStatus = (event) => {
      const { message } = event.detail;
      setTranslationStatus(message);
      // Removed auto-scrolling behavior to prevent viewport jumping
    };

    window.addEventListener('translation-status', handleTranslationStatus);
    return () => window.removeEventListener('translation-status', handleTranslationStatus);
  }, []);

  // Load translations from cache on component mount
  useEffect(() => {
    // Only try to load from cache if we don't have results yet and have subtitles to translate
    if (translatedSubtitles || !subtitles || subtitles.length === 0) return;

    // Don't load from cache if translation was manually reset
    if (wasManuallyReset) {
      console.log('Translation was manually reset, not loading from cache');
      return;
    }

    try {
      // Get current media ID
      const mediaId = getCurrentMediaId();
      if (!mediaId) return;

      // Generate a hash of the subtitles
      const subtitleHash = generateSubtitleHash(subtitles);

      // Get cache entry
      const cacheEntryJson = localStorage.getItem(TRANSLATION_CACHE_KEY);
      if (!cacheEntryJson) return;

      const cacheEntry = JSON.parse(cacheEntryJson);

      // Check if cache entry is for the current media and subtitles
      if (cacheEntry.mediaId !== mediaId || cacheEntry.subtitleHash !== subtitleHash) return;

      // Check if we have translations
      if (!cacheEntry.translations || !cacheEntry.translations.length) return;

      // Set loading state first
      setLoadedFromCache(true);

      // Use a small timeout to ensure the loading state is rendered
      setTimeout(() => {
        // Set the translated subtitles
        setTranslatedSubtitles(cacheEntry.translations);

        // Call the callback
        if (onTranslationComplete) {
          onTranslationComplete(cacheEntry.translations);
        }

        // Dispatch a custom event to notify other components that translation is complete
        window.dispatchEvent(new CustomEvent('translation-complete', {
          detail: {
            translatedSubtitles: cacheEntry.translations,
            loadedFromCache: true
          }
        }));

        // Show a status message
        setTranslationStatus(t('translation.loadedFromCache', 'Translations loaded from cache'));
      }, 100);
    } catch (error) {
      console.error('Error loading translations from cache:', error);
    }
  }, [subtitles, translatedSubtitles, onTranslationComplete, t, wasManuallyReset]);

  // Check if transcription rules are available
  useEffect(() => {
    const checkRulesAvailability = async () => {
      try {
        // Dynamically import to avoid circular dependencies
        const { getTranscriptionRulesSync } = await import('../utils/transcriptionRulesStore');
        const rules = getTranscriptionRulesSync();
        const hasRules = !!rules;
        setRulesAvailable(hasRules);

        // If rules are not available, set includeRules to false
        if (!hasRules) {
          setIncludeRules(false);
          localStorage.setItem('translation_include_rules', 'false');
        }


      } catch (error) {
        console.error('Error checking transcription rules availability:', error);
        setRulesAvailable(false);
        setIncludeRules(false);
        localStorage.setItem('translation_include_rules', 'false');
      }
    };

    checkRulesAvailability();
  }, []);

  // Load user-provided subtitles
  useEffect(() => {
    const loadUserProvidedSubtitles = async () => {
      try {
        // Dynamically import to avoid circular dependencies
        const { getUserProvidedSubtitlesSync } = await import('../utils/userSubtitlesStore');
        const subtitles = getUserProvidedSubtitlesSync();
        setUserProvidedSubtitles(subtitles || '');

        // If user-provided subtitles are present, set includeRules to false
        if (subtitles && subtitles.trim() !== '') {
          setIncludeRules(false);
          localStorage.setItem('translation_include_rules', 'false');
        }


      } catch (error) {
        console.error('Error loading user-provided subtitles:', error);
        setUserProvidedSubtitles('');
      }
    };

    loadUserProvidedSubtitles();
  }, []);

  /**
   * Handle model selection for translation only
   * @param {string} modelId - Selected model ID
   */
  const handleModelSelect = (modelId) => {
    // Update the local state
    setSelectedModel(modelId);
    // Save to translation-specific localStorage key to remember the choice
    // This keeps the translation model independent from the settings
    localStorage.setItem('translation_model', modelId);
  };

  /**
   * Handle saving custom prompt
   * @param {string} newPrompt - New custom prompt
   */
  const handleSavePrompt = (newPrompt) => {
    setCustomTranslationPrompt(newPrompt);
    localStorage.setItem('custom_prompt_translation', newPrompt);
  };

  /**
   * Handle translation (includes both main and bulk translation)
   * @param {Array} languages - Languages to translate to
   * @param {string|null} delimiter - Delimiter for multi-language translation
   * @param {boolean} useParentheses - Whether to use parentheses for the second language
   * @param {Object} bracketStyle - Optional bracket style { open, close }
   * @param {Array} chainItems - Optional chain items for format mode
   */
  const handleTranslate = async (languages, delimiter = ' ', useParentheses = false, bracketStyle = null, chainItems = null) => {
    // Reset the processing force stopped flag at the start of any new translation
    setProcessingForceStopped(false);

    // Check if at least one language is entered (unless in format mode with chainItems)
    if (languages.length === 0 && !chainItems) {
      setError(t('translation.languageRequired', 'Please enter at least one target language'));
      return;
    }

    // Check if we have main subtitles to translate
    const hasMainSubtitles = subtitles && subtitles.length > 0;
    const hasBulkFiles = bulkFiles.length > 0;

    if (!hasMainSubtitles && !hasBulkFiles) {
      setError(t('translation.noSubtitles', 'No subtitles to translate'));
      return;
    }

    // If there are bulk files, handle bulk translation first
    if (hasBulkFiles) {
      await handleBulkTranslate(languages, delimiter, useParentheses, bracketStyle, chainItems, hasMainSubtitles);

      // Check if bulk translation was cancelled - if so, don't continue with main translation
      if (getProcessingForceStopped()) {
        console.log('Bulk translation was cancelled, skipping main translation');
        return;
      }
    }

    // Continue with main translation if there are main subtitles
    if (!hasMainSubtitles) {
      return;
    }

    // Check if processing has been force stopped before starting main translation
    if (getProcessingForceStopped()) {
      console.log('Translation was cancelled before main translation could start');
      return;
    }

    setError('');
    setIsTranslating(true);

    // Reset the manual reset flag when starting a new translation
    setWasManuallyReset(false);

    try {
      // For 2 target languages, we can use both delimiter and brackets
      // For 3+ languages, we only use delimiter
      const useBothOptions = languages.length === 2 && useParentheses;

      // Pass the selected model, custom prompt, split duration, includeRules, delimiter and parentheses options
      const result = await translateSubtitles(
        subtitles,
        languages.length === 1 ? languages[0] : languages,
        selectedModel,
        customTranslationPrompt,
        splitDuration,
        includeRules,
        useBothOptions ? delimiter : (useParentheses ? null : delimiter), // Pass delimiter even when using parentheses for 2 languages
        useParentheses,
        bracketStyle, // Pass the bracket style
        chainItems, // Pass the chain items for format mode
        'main' // File context for main translation
      );


      // Check if result is valid
      if (!result || result.length === 0) {
        console.error('Translation returned empty result');
        setError(t('translation.emptyResult', 'Translation returned no results. Please try again or check the console for errors.'));
        return;
      }

      // Save translations to cache
      try {
        // Get current media ID
        const mediaId = getCurrentMediaId();
        if (mediaId) {
          // Generate a hash of the subtitles
          const subtitleHash = generateSubtitleHash(subtitles);

          // Create cache entry
          const cacheEntry = {
            mediaId,
            subtitleHash,
            timestamp: Date.now(),
            translations: result
          };

          // Save to localStorage
          localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cacheEntry));
        }
      } catch (error) {
        console.error('Error saving translations to cache:', error);
      }

      setTranslatedSubtitles(result);

      // Update final status if bulk translations were also completed
      if (bulkTranslations.length > 0) {
        const successfulBulkFiles = bulkTranslations.filter(r => r.success).length;
        const totalFiles = bulkTranslations.length + 1; // +1 for main file
        const totalSuccessful = successfulBulkFiles + 1; // +1 for main file (which just succeeded)

        setTranslationStatus(t('translation.allComplete', 'All translations complete: {{success}}/{{total}} files processed successfully', {
          success: totalSuccessful,
          total: totalFiles
        }));
      }

      if (onTranslationComplete) {
        onTranslationComplete(result);
      }

      // Dispatch a custom event to notify other components that translation is complete
      window.dispatchEvent(new CustomEvent('translation-complete', {
        detail: {
          translatedSubtitles: result,
          loadedFromCache: false
        }
      }));


      // Save the split duration setting to localStorage
      localStorage.setItem('translation_split_duration', splitDuration.toString());
    } catch (err) {
      console.error('Translation error:', err);

      // Check if this was a cancellation
      if (err.message && (err.message.includes('cancelled') || err.message.includes('aborted'))) {
        setTranslationStatus(t('translation.cancelled', 'Translation cancelled by user'));
      } else {
        // Use the specific error message if available, otherwise use generic message
        setError(err.message || t('translation.error', 'Error translating subtitles. Please try again.'));
      }
    } finally {
      setIsTranslating(false);
    }
  };

  /**
   * Handle cancellation of translation
   */
  const handleCancelTranslation = () => {

    // Call the cancelTranslation function from the translation service
    // This will abort all active requests and set the processingForceStopped flag to true
    // Note: The processingForceStopped flag will be reset to false when starting a new translation
    // or when resetting the translation
    /* const aborted = */ cancelTranslation();

    // Update UI state for both main and bulk translation
    setIsTranslating(false);
    setIsBulkTranslating(false);
    setCurrentBulkFileIndex(-1);
    setError(t('translation.cancelled', 'Translation cancelled by user'));

    // Update translation status to show cancellation
    setTranslationStatus(t('translation.cancelled', 'Translation cancelled by user'));
  };

  /**
   * Handle reset of translation
   */
  const handleReset = () => {
    console.log('Manual translation reset initiated');

    setTranslatedSubtitles(null);
    setError('');
    setLoadedFromCache(false);

    // Set the manual reset flag to prevent cache loading
    setWasManuallyReset(true);

    // Reset the processing force stopped flag when resetting translation
    setProcessingForceStopped(false);

    // Clear the translation cache
    try {
      localStorage.removeItem(TRANSLATION_CACHE_KEY);
      console.log('Translation cache cleared');
    } catch (error) {
      console.error('Error clearing translation cache:', error);
    }

    if (onTranslationComplete) {
      onTranslationComplete(null);
    }

    // Dispatch a custom event to notify other components that translation has been reset
    window.dispatchEvent(new CustomEvent('translation-reset', {
      detail: {
        translatedSubtitles: null
      }
    }));

  };

  /**
   * Handle split duration change
   * @param {number} value - New split duration value
   */
  const handleSplitDurationChange = (value) => {
    setSplitDuration(value);
    localStorage.setItem('translation_split_duration', value.toString());
  };

  /**
   * Handle rest time change
   * @param {number} value - New rest time value in seconds
   */
  const handleRestTimeChange = (value) => {
    setRestTime(value);
    localStorage.setItem('translation_rest_time', value.toString());
  };

  /**
   * Handle include rules toggle
   * @param {boolean} value - New include rules value
   */
  const handleIncludeRulesChange = (value) => {
    setIncludeRules(value);
    localStorage.setItem('translation_include_rules', value.toString());
  };

  /**
   * Handle bulk translation
   * @param {Array} languages - Languages to translate to
   * @param {string|null} delimiter - Delimiter for multi-language translation
   * @param {boolean} useParentheses - Whether to use parentheses for the second language
   * @param {Object} bracketStyle - Optional bracket style { open, close }
   * @param {Array} chainItems - Optional chain items for format mode
   * @param {boolean} hasMainSubtitles - Whether there are main subtitles to translate after bulk
   */
  const handleBulkTranslate = async (languages, delimiter = ' ', useParentheses = false, bracketStyle = null, chainItems = null, hasMainSubtitles = false) => {
    if (bulkFiles.length === 0) {
      setError(t('translation.bulk.noFiles', 'No files added for bulk translation'));
      return;
    }

    setIsBulkTranslating(true);
    setError('');
    setBulkTranslations([]);
    setCurrentBulkFileIndex(0);

    const results = [];

    try {
      // Process each file sequentially
      for (let i = 0; i < bulkFiles.length; i++) {
        // Check if processing has been force stopped before processing each file
        if (getProcessingForceStopped()) {
          console.log('Bulk translation cancelled by user');
          throw new Error('Bulk translation was cancelled by user');
        }

        setCurrentBulkFileIndex(i);
        const bulkFile = bulkFiles[i];

        // Update status - include main file in total count if it exists
        const totalFiles = bulkFiles.length + (hasMainSubtitles ? 1 : 0);
        setTranslationStatus(t('translation.bulk.processing', 'Processing file {{current}}/{{total}}: {{filename}}', {
          current: i + 1,
          total: totalFiles,
          filename: bulkFile.name
        }));

        try {
          // Use the same translation settings but skip context rules
          const result = await translateSubtitles(
            bulkFile.subtitles,
            languages.length === 1 ? languages[0] : languages,
            selectedModel,
            null, // Skip custom prompt/context rules for bulk translation
            splitDuration,
            false, // Skip include rules for bulk translation
            languages.length === 2 && useParentheses ? delimiter : (useParentheses ? null : delimiter),
            useParentheses,
            bracketStyle,
            chainItems,
            bulkFile.name // File context for bulk translation
          );

          if (result && result.length > 0) {
            results.push({
              originalFile: bulkFile,
              translatedSubtitles: result,
              success: true
            });
          } else {
            results.push({
              originalFile: bulkFile,
              error: t('translation.emptyResult', 'Translation returned no results'),
              success: false
            });
          }
        } catch (fileError) {
          console.error(`Error translating file ${bulkFile.name}:`, fileError);

          // Check if this was a cancellation error
          if (fileError.message && fileError.message.includes('aborted')) {
            console.log('File translation was cancelled, stopping bulk translation');
            throw new Error('Bulk translation was cancelled by user');
          }

          results.push({
            originalFile: bulkFile,
            error: fileError.message || t('translation.error', 'Error translating subtitles'),
            success: false
          });
        }

        // Check if processing has been force stopped after each file
        if (getProcessingForceStopped()) {
          console.log('Bulk translation cancelled by user after file completion');
          throw new Error('Bulk translation was cancelled by user');
        }
      }

      setBulkTranslations(results);

      // Calculate total files including main file if it exists
      const totalFiles = results.length + (hasMainSubtitles ? 1 : 0);
      const successfulBulkFiles = results.filter(r => r.success).length;

      if (hasMainSubtitles) {
        // If there's a main file to translate, show intermediate status
        setTranslationStatus(t('translation.bulk.completeWithMain', 'Bulk files complete: {{success}}/{{bulkTotal}} bulk files processed, main file next ({{current}}/{{total}} total)', {
          success: successfulBulkFiles,
          bulkTotal: results.length,
          current: successfulBulkFiles,
          total: totalFiles
        }));
      } else {
        // If no main file, show final status
        setTranslationStatus(t('translation.bulk.complete', 'Bulk translation complete: {{success}}/{{total}} files processed successfully', {
          success: successfulBulkFiles,
          total: totalFiles
        }));
      }

    } catch (error) {
      console.error('Bulk translation error:', error);

      // Check if this was a cancellation
      if (error.message && (error.message.includes('cancelled') || error.message.includes('aborted'))) {
        setTranslationStatus(t('translation.cancelled', 'Translation cancelled by user'));
      } else {
        setError(t('translation.bulk.error', 'Error during bulk translation: {{message}}', { message: error.message }));
      }
    } finally {
      setIsBulkTranslating(false);
      setCurrentBulkFileIndex(-1);
    }
  };

  /**
   * Handle bulk file removal with translation cleanup
   * @param {string} fileId - ID of the file to remove
   */
  const handleBulkFileRemoval = (fileId) => {
    // Remove the file from bulk files
    const updatedBulkFiles = bulkFiles.filter(bf => bf.id !== fileId);
    setBulkFiles(updatedBulkFiles);

    // Remove corresponding translation result if it exists
    const updatedBulkTranslations = bulkTranslations.filter(bt => bt.originalFile.id !== fileId);
    setBulkTranslations(updatedBulkTranslations);
  };

  /**
   * Handle bulk files removal (remove all) with translation cleanup
   */
  const handleBulkFilesRemovalAll = () => {
    setBulkFiles([]);
    setBulkTranslations([]);
  };



  return {
    isTranslating,
    translatedSubtitles,
    error,
    translationStatus,
    selectedModel,
    customTranslationPrompt,
    splitDuration,
    restTime,
    includeRules,
    rulesAvailable,
    hasUserProvidedSubtitles,
    loadedFromCache,
    statusRef,
    handleModelSelect,
    handleSavePrompt,
    handleTranslate,
    handleCancelTranslation,
    handleReset,
    handleSplitDurationChange,
    handleRestTimeChange,
    handleIncludeRulesChange,
    // Bulk translation
    bulkFiles,
    setBulkFiles,
    bulkTranslations,
    isBulkTranslating,
    currentBulkFileIndex,
    handleBulkTranslate,
    handleBulkFileRemoval,
    handleBulkFilesRemovalAll
  };
};

export default useTranslationState;
