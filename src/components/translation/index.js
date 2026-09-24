import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadSRT, downloadJSON, downloadTXT } from '../../utils/fileUtils';
import { completeDocument, summarizeDocument } from '../../services/geminiService';
import useTranslationState from '../../hooks/useTranslationState';
import useLanguageChain from '../../hooks/useLanguageChain';
import TranslationHeader from './TranslationHeader';
import LanguageChain from './LanguageChain';
import ModelSelection from './ModelSelection';
import SplitDurationSlider from './SplitDurationSlider';
import RestTimeSlider from './RestTimeSlider';
import RulesToggle from './RulesToggle';
import TranslationPromptEditorButton from './TranslationPromptEditorButton';
import TranslationActions from './TranslationActions';
import TranslationStatus from './TranslationStatus';
import TranslationError from './TranslationError';
import TranslationPreview from './TranslationPreview';
import TranslationComplete from './TranslationComplete';
// Narration section moved to OutputContainer
import '../../styles/translation/index.css';
import '../../styles/translation/languageChain.css';
// Narration styles moved to OutputContainer

/**
 * Translation section component
 * @param {Object} props - Component props
 * @param {Array} props.subtitles - Subtitles to translate
 * @param {string} props.videoTitle - Video title for download filenames
 * @param {Function} props.onTranslationComplete - Callback when translation is complete
 * @returns {JSX.Element} - Rendered component
 */
const TranslationSection = ({
  subtitles,
  videoTitle,
  onTranslationComplete,
  currentTime = 0,
  duration = 0,
  onLyricClick,
  onTranslatedSubtitlesUpdate,
  onSaveTranslatedSubtitles
}) => {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [txtContent, setTxtContent] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [isProcessing, setIsProcessing] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [processedDocument, setProcessedDocument] = useState(null);

  // Refs for height animation
  const containerRef = useRef(null);
  const contentRef = useRef(null);

  // Use language chain hook for managing languages and delimiters
  const {
    chainItems,
    addLanguage,
    addOriginalLanguage,
    addDelimiter,
    removeItem,
    updateLanguage,
    updateDelimiter,
    moveItem,
    getLanguageValues,
    getDelimiterValues,
    hasValidLanguage,
    hasOnlyOriginalLanguage
  } = useLanguageChain(false); // false = don't include original language by default

  // Get target languages from chain items
  const targetLanguages = chainItems.filter(item => item.type === 'language' && !item.isOriginal);

  const {
    isTranslating,
    translatedSubtitles,
    setTranslatedSubtitles,
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
    handleTranslate: translate,
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
    handleBulkFileRemoval,
    handleBulkFilesRemovalAll
  } = useTranslationState(subtitles, onTranslationComplete);

  const handleTranslatedSubtitlesUpdate = (updatedSubtitles) => {
    setTranslatedSubtitles(updatedSubtitles);
    onTranslatedSubtitlesUpdate?.(updatedSubtitles);
  };

  // Initialize container height on component mount
  useEffect(() => {
    if (containerRef.current && contentRef.current) {
      // Small delay to ensure the DOM is fully rendered
      setTimeout(() => {
        // Set initial height with extra 100px to ensure enough space
        const contentHeight = contentRef.current.offsetHeight;
        containerRef.current.style.height = `${contentHeight + 150}px`;
      }, 50);
    }
  }, []);

  // Handle height animation when content changes
  useEffect(() => {
    // Use a small delay to ensure the new content is rendered
    const animationTimeout = setTimeout(() => {
      if (containerRef.current && contentRef.current) {
        // Get the height of the content and add 100px for extra space
        const contentHeight = contentRef.current.offsetHeight;

        // Set the container height to match the content height plus extra space
        containerRef.current.style.height = `${contentHeight + 150}px`;
      }
    }, 50); // Small delay to ensure content is rendered

    return () => clearTimeout(animationTimeout);
  }, [translatedSubtitles, isTranslating, error, bulkFiles, bulkTranslations]); // Re-run when these state values change

  // Wrapper for handleTranslate to pass the current languages and delimiter settings
  const handleTranslate = () => {
    // Format mode - only original language in the chain
    const isFormatMode = hasOnlyOriginalLanguage();

    // In format mode, we don't need to check for valid languages
    if (!isFormatMode && !hasValidLanguage()) {
      return;
    }

    // Always pass the chain items to ensure the exact arrangement is preserved


    if (isFormatMode) {
      // In format mode, pass empty languages array
      translate([], '', false, null, chainItems);
    } else {
      // In translation mode, pass languages and chain items
      // Get the first delimiter's value and style (if any) as fallback
      const delimiters = getDelimiterValues();
      const firstDelimiter = delimiters.length > 0 ? delimiters[0] : { value: ' ', style: { open: '', close: '' } };

      // Check if we're using brackets (parentheses)
      const useParentheses = firstDelimiter.style && (firstDelimiter.style.open || firstDelimiter.style.close);

      // Get languages for translation
      const languages = getLanguageValues();

      // Pass both the languages and the chain items
      translate(languages, firstDelimiter.value, useParentheses, firstDelimiter.style, chainItems);
    }
  };

  // Generate comprehensive filename based on priority system
  const generateFilename = (source, namingInfo = {}) => {
    const { sourceSubtitleName = '', videoName = '', targetLanguages: targetLangs = [] } = namingInfo;

    // Priority 1: Source subtitle name (remove extension)
    let baseName = '';
    if (sourceSubtitleName) {
      baseName = sourceSubtitleName.replace(/\.(srt|json)$/i, '');
    }
    // Priority 2: Video name (remove extension)
    else if (videoName) {
      baseName = videoName.replace(/\.[^/.]+$/, '');
    }
    // Fallback: Use video title or default
    else {
      baseName = videoTitle || 'subtitles';
    }

    // Add language suffix for translations
    let langSuffix = '';
    if (source === 'translated' && targetLangs.length > 0) {
      if (targetLangs.length === 1) {
        // Single language: use the language name
        const langName = targetLangs[0].value || targetLangs[0];
        langSuffix = `_${langName.toLowerCase().replace(/\s+/g, '_')}`;
      } else {
        // Multiple languages: use multi_lang
        langSuffix = '_multi_lang';
      }
    }

    return `${baseName}${langSuffix}`;
  };

  // Get naming information for downloads
  const getNamingInfo = () => {
    // Get uploaded SRT info
    let sourceSubtitleName = '';
    try {
      const uploadedSrtInfo = localStorage.getItem('uploaded_srt_info');
      if (uploadedSrtInfo) {
        const srtInfo = JSON.parse(uploadedSrtInfo);
        if (srtInfo.hasUploaded && srtInfo.fileName) {
          sourceSubtitleName = srtInfo.fileName;
        }
      }
    } catch (error) {
      console.error('Error parsing uploaded SRT info:', error);
    }

    return {
      sourceSubtitleName,
      videoName: videoTitle,
      targetLanguages
    };
  };

  // Handle download request from modal
  const handleDownload = (source, format, namingInfo = {}) => {
    const subtitlesToUse = source === 'translated' ? translatedSubtitles : subtitles;

    if (subtitlesToUse && subtitlesToUse.length > 0) {
      // Use provided naming info or get it from local state
      const finalNamingInfo = Object.keys(namingInfo).length > 0 ? namingInfo : getNamingInfo();
      const baseFilename = generateFilename(source, finalNamingInfo);

      switch (format) {
        case 'srt':
          downloadSRT(subtitlesToUse, `${baseFilename}.srt`);
          break;
        case 'json':
          downloadJSON(subtitlesToUse, `${baseFilename}.json`);
          break;
        case 'txt':
          const content = downloadTXT(subtitlesToUse, `${baseFilename}.txt`);
          setTxtContent(content);
          break;
        default:
          break;
      }
    }
  };

  // Generate filename for bulk translations
  const generateBulkFilename = (originalName, targetLanguages) => {
    // Remove extension from original name
    const baseName = originalName.replace(/\.(srt|json)$/i, '');

    // Create language suffix
    const languageSuffix = targetLanguages.map(lang => lang.value || lang).join('_');

    return `${baseName}_${languageSuffix}`;
  };

  // Handle bulk download all (includes main translation + bulk translations)
  const handleBulkDownloadAll = () => {
    const allDownloads = [];

    // Add main translation if available (always as SRT since it comes from video processing)
    if (translatedSubtitles && translatedSubtitles.length > 0) {
      const namingInfo = getNamingInfo();
      const baseFilename = generateFilename('translated', namingInfo);

      allDownloads.push({
        subtitles: translatedSubtitles,
        filename: `${baseFilename}.srt`,
        format: 'srt'
      });
    }

    // Add bulk translations
    const successfulBulkTranslations = bulkTranslations.filter(bt => bt.success);
    successfulBulkTranslations.forEach(bulkTranslation => {
      const originalFile = bulkTranslation.originalFile;
      const translatedSubtitles = bulkTranslation.translatedSubtitles;
      const originalFormat = originalFile.name.toLowerCase().endsWith('.json') ? 'json' : 'srt';

      // Generate filename with target languages
      const baseFilename = generateBulkFilename(originalFile.name, targetLanguages);
      const filename = `${baseFilename}.${originalFormat}`;

      allDownloads.push({
        subtitles: translatedSubtitles,
        filename: filename,
        format: originalFormat
      });
    });

    // Download all files
    allDownloads.forEach(download => {
      if (download.format === 'json') {
        downloadJSON(download.subtitles, download.filename);
      } else {
        downloadSRT(download.subtitles, download.filename);
      }
    });
  };

  // Handle bulk download as ZIP
  const handleBulkDownloadZip = async () => {
    try {
      // Dynamic import of JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Add main translation if available (always as SRT since it comes from video processing)
      if (translatedSubtitles && translatedSubtitles.length > 0) {
        const namingInfo = getNamingInfo();
        const baseFilename = generateFilename('translated', namingInfo);

        // Add SRT version only
        const srtContent = translatedSubtitles.map(subtitle =>
          `${subtitle.index}\n${subtitle.start} --> ${subtitle.end}\n${subtitle.text}\n`
        ).join('\n');
        zip.file(`${baseFilename}.srt`, srtContent);
      }

      // Add bulk translations (in same format as original files)
      bulkTranslations.forEach(bulkTranslation => {
        if (bulkTranslation.success && bulkTranslation.translatedSubtitles) {
          const originalFile = bulkTranslation.originalFile;
          const originalFormat = originalFile.name.toLowerCase().endsWith('.json') ? 'json' : 'srt';

          // Generate filename with target languages
          const baseFilename = generateBulkFilename(originalFile.name, targetLanguages);
          const filename = `${baseFilename}.${originalFormat}`;

          // Add in original format only
          if (originalFormat === 'json') {
            const jsonContent = JSON.stringify(bulkTranslation.translatedSubtitles, null, 2);
            zip.file(filename, jsonContent);
          } else {
            const srtContent = bulkTranslation.translatedSubtitles.map(subtitle =>
              `${subtitle.index}\n${subtitle.start} --> ${subtitle.end}\n${subtitle.text}\n`
            ).join('\n');
            zip.file(filename, srtContent);
          }
        }
      });

      // Generate ZIP file
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Create descriptive ZIP filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      const targetLanguagesSuffix = targetLanguages.length > 0
        ? `_${targetLanguages.map(lang => lang.value.toLowerCase().replace(/\s+/g, '_')).join('_')}`
        : '';
      const zipFilename = `translated_subtitles${targetLanguagesSuffix}_${timestamp}.zip`;

      // Create download link
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = zipFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error('Error creating ZIP file:', error);
      // Fallback to individual downloads
      handleBulkDownloadAll();
    }
  };

  // Handle process request from modal
  const handleProcess = async (source, processType, model, splitDurationParam, customPrompt, namingInfo = {}) => {
    const subtitlesToUse = source === 'translated' ? translatedSubtitles : subtitles;

    if (!subtitlesToUse || subtitlesToUse.length === 0) return;

    // First, get the text content if we don't have it yet
    let textContent = txtContent;
    if (!textContent) {
      textContent = subtitlesToUse.map(subtitle => subtitle.text).join('\\n\\n');
      setTxtContent(textContent);
    }

    setIsProcessing(true);
    try {
      let result;
      // For multi-language translations, use the first non-empty language or null
      let targetLang = null;
      if (source === 'translated') {
        if (targetLanguages.length > 1) {
          // For multi-language, we'll use the first valid language
          const validLanguage = targetLanguages.find(lang => lang.value?.trim() !== '');
          targetLang = validLanguage?.value || null;
        } else {
          targetLang = targetLanguages[0]?.value || null;
        }
      }

      if (processType === 'consolidate') {
        result = await completeDocument(textContent, selectedModel, targetLang);
      } else if (processType === 'summarize') {
        result = await summarizeDocument(textContent, selectedModel, targetLang);
      }

      // Check if the result is JSON and extract plain text
      if (result && typeof result === 'string' && (result.trim().startsWith('{') || result.trim().startsWith('['))) {
        try {
          const jsonResult = JSON.parse(result);


          // For summarize feature
          if (jsonResult.summary) {
            let plainText = jsonResult.summary;

            // Add key points if available
            if (jsonResult.keyPoints && Array.isArray(jsonResult.keyPoints) && jsonResult.keyPoints.length > 0) {
              plainText += '\\n\\nKey Points:\\n';
              jsonResult.keyPoints.forEach((point, index) => {
                plainText += `\\n${index + 1}. ${point}`;
              });
            }

            result = plainText;

          }
          // For consolidate feature
          else if (jsonResult.content) {
            result = jsonResult.content;

          }
          // For any other JSON structure
          else if (jsonResult.text) {
            result = jsonResult.text;

          }
        } catch (e) {

          // Keep the original result if parsing fails
        }
      }

      setProcessedDocument(result);

      // Show a temporary success message
      const successMessage = document.createElement('div');
      successMessage.className = 'save-success-message';
      successMessage.textContent = processType === 'consolidate'
        ? t('output.documentCompleted', 'Document completed successfully')
        : t('output.summaryCompleted', 'Summary completed successfully');
      document.body.appendChild(successMessage);

      // Remove the message after 3 seconds
      setTimeout(() => {
        if (document.body.contains(successMessage)) {
          document.body.removeChild(successMessage);
        }
      }, 3000);

      // Download the processed document
      // Use provided naming info or get it from local state
      const finalNamingInfo = Object.keys(namingInfo).length > 0 ? namingInfo : getNamingInfo();
      const baseFilename = generateFilename(source, finalNamingInfo);
      const processTypeSuffix = processType === 'consolidate' ? 'completed' : 'summary';
      const filename = `${baseFilename}_${processTypeSuffix}.txt`;

      const blob = new Blob([result], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error(`Error ${processType === 'consolidate' ? 'completing' : 'summarizing'} document:`, error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="translation-section" ref={containerRef}>
      <TranslationHeader
        promptEditorButton={
          <TranslationPromptEditorButton
            customPrompt={customTranslationPrompt}
            onSavePrompt={handleSavePrompt}
          />
        }
      />

      <div className={`translation-controls ${translatedSubtitles ? 'state-results' : 'state-form'}`} ref={contentRef}>
        {/* Language Chain UI */}
        <div className="translation-row language-chain-row">
          <div className="row-label">
            <label>{t('translation.languageChain', 'Language Chain')}:</label>
          </div>
          <div className="row-content">
            <LanguageChain
              chainItems={chainItems}
              onAddLanguage={addLanguage}
              onAddOriginalLanguage={addOriginalLanguage}
              onAddDelimiter={addDelimiter}
              onRemoveItem={removeItem}
              onUpdateLanguage={updateLanguage}
              onUpdateDelimiter={updateDelimiter}
              onMoveItem={moveItem}
              disabled={isTranslating || isBulkTranslating || translatedSubtitles !== null}
              showOriginalOption={true}
            />
          </div>
        </div>

        {/* If we have translated subtitles, show the complete view */}
        {translatedSubtitles ? (
          <TranslationComplete
            onReset={handleReset}
            isModalOpen={isModalOpen}
            setIsModalOpen={setIsModalOpen}
            onDownload={handleDownload}
            onProcess={handleProcess}
            hasTranslation={translatedSubtitles && translatedSubtitles.length > 0}
            hasOriginal={subtitles && subtitles.length > 0}
            sourceSubtitleName={getNamingInfo().sourceSubtitleName}
            videoName={getNamingInfo().videoName}
            targetLanguages={getNamingInfo().targetLanguages}
            hasBulkTranslations={bulkTranslations.length > 0 && bulkTranslations.some(bt => bt.success)}
            onDownloadAll={handleBulkDownloadAll}
            onDownloadZip={handleBulkDownloadZip}
          />
        ) : (
          <>
            {/* Check if we're in format mode (only original language) */}
            {!hasOnlyOriginalLanguage() && (
              <>
                {/* Model selection */}
                <ModelSelection
                  selectedModel={selectedModel}
                  onModelSelect={handleModelSelect}
                  disabled={isTranslating || isBulkTranslating}
                />

                {/* Split duration slider */}
                <SplitDurationSlider
                  splitDuration={splitDuration}
                  onSplitDurationChange={handleSplitDurationChange}
                  subtitles={subtitles}
                  disabled={isTranslating || isBulkTranslating}
                />

                {/* Rest time slider */}
                <RestTimeSlider
                  restTime={restTime}
                  onRestTimeChange={handleRestTimeChange}
                  disabled={isTranslating || isBulkTranslating}
                />

                {/* Include rules toggle */}
                <RulesToggle
                  includeRules={includeRules}
                  onIncludeRulesChange={handleIncludeRulesChange}
                  rulesAvailable={rulesAvailable}
                  hasUserProvidedSubtitles={hasUserProvidedSubtitles}
                  disabled={isTranslating || isBulkTranslating}
                />
              </>
            )}

            {/* Translation actions */}
            <TranslationActions
              isTranslating={isTranslating || isBulkTranslating}
              onTranslate={handleTranslate}
              onCancel={handleCancelTranslation}
              disabled={!hasOnlyOriginalLanguage() && !hasValidLanguage()}
              isFormatMode={hasOnlyOriginalLanguage()}
              bulkFiles={bulkFiles}
              onBulkFilesChange={setBulkFiles}
              onBulkFileRemoval={handleBulkFileRemoval}
              onBulkFilesRemovalAll={handleBulkFilesRemovalAll}
              hasBulkTranslations={bulkTranslations.length > 0 && bulkTranslations.some(bt => bt.success)}
              onDownloadAll={handleBulkDownloadAll}
              onDownloadZip={handleBulkDownloadZip}
              splitDuration={splitDuration}
            />

            {/* Translation status */}
            {(isTranslating || isBulkTranslating) && (
              <TranslationStatus
                status={translationStatus}
                statusRef={statusRef}
              />
            )}
          </>
        )}

        {/* Error message */}
        <TranslationError error={error} />

        {/* Translation preview - only show for main translation without bulk files */}
        {translatedSubtitles && bulkTranslations.length === 0 && (
          <TranslationPreview
            translatedSubtitles={translatedSubtitles}
            targetLanguages={targetLanguages}
            loadedFromCache={loadedFromCache}
            currentTime={currentTime}
            duration={duration}
            onLyricClick={onLyricClick}
            onUpdateLyrics={handleTranslatedSubtitlesUpdate}
            onSaveSubtitles={onSaveTranslatedSubtitles || handleTranslatedSubtitlesUpdate}
            videoTitle={videoTitle}
          />
        )}

        {/* Narration Section moved to OutputContainer */}
      </div>
    </div>
  );
};

export default TranslationSection;
