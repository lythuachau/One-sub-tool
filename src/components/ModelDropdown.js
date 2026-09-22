import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiChevronDown, FiStar, FiZap, FiCpu, FiTrendingUp } from 'react-icons/fi';
import '../styles/ModelDropdown.css';
import { useGeminiModels } from '../hooks/useGeminiModels';
import { getGeminiModelLabel } from '../services/gemini/modelDiscovery';

/**
 * Reusable component for model selection dropdown
 * @param {Object} props - Component props
 * @param {Function} props.onModelSelect - Function called when a model is selected
 * @param {string} props.selectedModel - Currently selected model ID
 * @param {string} props.buttonClassName - Additional class name for the button
 * @param {string} props.label - Label to display on the button (optional)
 * @param {string} props.headerText - Text to display in the dropdown header
 * @param {boolean} props.isTranslationSection - Whether this dropdown is used in the translation section
 * @param {boolean} props.disabled - Whether the dropdown is disabled
 * @returns {JSX.Element} - Rendered component
 */
const ModelDropdown = ({
  onModelSelect,
  selectedModel = 'gemini-flash-latest',
  buttonClassName = '',
  label = '',
  headerText,
  isTranslationSection = false,
  disabled = false
}) => {
  const { t } = useTranslation();
  const { models, isLoading, error } = useGeminiModels();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  const modelOptions = models
    .map((model) => {
      const id = model.id;
      const isPro = id.includes('pro');
      const isLite = id.includes('lite');
      const isFlash = id.includes('flash');

      return {
        ...model,
        id,
        name: getGeminiModelLabel(model),
        description: isTranslationSection
          ? t('translation.dynamicModelDescription', 'Provider model supporting generateContent')
          : (model.description || t('models.dynamicModel', 'Detected from the active API key')),
        icon: isPro
          ? <FiStar className="model-icon star-icon" />
          : isLite
            ? <FiTrendingUp className="model-icon trending-icon" />
            : isFlash
              ? <FiZap className="model-icon zap-icon" />
              : <FiCpu className="model-icon cpu-icon" />,
        color: isPro ? 'var(--md-tertiary)' : 'var(--md-primary)',
        bgColor: isPro ? 'rgba(var(--md-tertiary-rgb), 0.1)' : 'rgba(var(--md-primary-rgb), 0.1)'
      };
    });

  // Get the currently selected model
  const currentModel = modelOptions.find(model => model.id === selectedModel) || modelOptions[0];
  const modelUnavailable = isLoading || modelOptions.length === 0;

  useEffect(() => {
    if (modelOptions.length > 0 && !modelOptions.some((model) => model.id === selectedModel)) {
      onModelSelect(modelOptions[0].id);
    }
  }, [modelOptions, onModelSelect, selectedModel]);

  // Position the dropdown relative to the button
  const positionDropdown = useCallback(() => {
    if (!buttonRef.current || !dropdownRef.current) return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const dropdownEl = dropdownRef.current;

    // Position above the button
    dropdownEl.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;

    // Ensure the dropdown doesn't go off-screen to the right
    const rightEdge = buttonRect.right;
    const windowWidth = window.innerWidth;
    const dropdownWidth = window.innerWidth <= 768 ? 220 : 380;

    if (rightEdge + dropdownWidth > windowWidth) {
      // Position to the left of the button's right edge
      dropdownEl.style.right = `${windowWidth - rightEdge}px`;
      dropdownEl.style.left = 'auto';
    } else {
      // Position aligned with button's left edge
      dropdownEl.style.left = `${buttonRect.left}px`;
      dropdownEl.style.right = 'auto';
    }
  }, []);

  // Handle button click
  const handleButtonClick = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    // Don't open if disabled
    if (disabled || isLoading || modelOptions.length === 0) return;

    // Toggle dropdown state
    setIsOpen(prev => !prev);
  }, [disabled, isLoading, modelOptions.length]);

  // Handle model selection
  const handleModelSelect = useCallback((e, modelId) => {
    e.preventDefault();
    e.stopPropagation();

    // Close the dropdown immediately
    setIsOpen(false);

    // Call the selection function
    onModelSelect(modelId);
  }, [onModelSelect]);

  // Handle clicks outside to close the dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };

    // Position the dropdown when it opens
    positionDropdown();

    // Add event listeners for repositioning
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', positionDropdown);
    window.addEventListener('scroll', positionDropdown, true); // Use capture to catch all scroll events
    document.addEventListener('scroll', positionDropdown, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', positionDropdown);
      window.removeEventListener('scroll', positionDropdown, true);
      document.removeEventListener('scroll', positionDropdown, true);
    };
  }, [isOpen, positionDropdown]);

  return (
    <div className={`model-dropdown-container ${isOpen ? 'dropdown-open' : ''}`}>
      <button
        className={`model-dropdown-btn ${buttonClassName} ${isOpen ? 'active-dropdown-btn' : ''} ${disabled || modelUnavailable ? 'disabled' : ''}`}
        onClick={handleButtonClick}
        title={disabled ? t('common.disabled', 'Disabled during translation') : isLoading ? t('models.loading', 'Checking available models...') : error ? t('models.noUsableModels', 'No verified models available') : t('common.selectModel', 'Select model')}
        ref={buttonRef}
        aria-haspopup="true"
        aria-expanded={isOpen}
        disabled={disabled || isLoading || modelOptions.length === 0}
      >
        {label && <span className="model-dropdown-label">{label}</span>}
        <span className="model-dropdown-selected">
          {currentModel?.icon || <FiCpu className="model-icon cpu-icon" />}
          <span className="model-name">
            {currentModel?.name || (isLoading
              ? t('models.loading', 'Checking available models...')
              : t('models.noUsableModels', 'No verified models available'))}
          </span>
        </span>
        <FiChevronDown size={14} className="dropdown-icon" />
      </button>

      {isOpen && (
        <div
          className="model-options-dropdown"
          ref={dropdownRef}
          role="menu"
        >
          <div className="model-options-header">
            {headerText || t('common.selectModel', 'Select model')}
          </div>
          <div className="model-options-list">
            {modelOptions.length === 0 && (
              <div className="model-options-empty">
                {isLoading
                  ? t('models.loading', 'Checking available models...')
                  : t('models.noUsableModels', 'No verified translation models are available for this API key.')}
              </div>
            )}
            {modelOptions.map((model) => (
              <button
                key={model.id}
                className={`model-option-btn ${model.id === selectedModel ? 'selected' : ''}`}
                onClick={(e) => handleModelSelect(e, model.id)}
                style={{
                  '--model-color': model.color,
                  '--model-bg-color': model.bgColor
                }}
                role="menuitem"
              >
                <div className="model-option-icon">{model.icon}</div>
                <div className="model-option-text">
                  <div className="model-option-name">
                    {model.name}
                  </div>
                  <div className="model-option-description">{model.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelDropdown;
