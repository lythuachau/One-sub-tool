import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGeminiModels } from '../../../hooks/useGeminiModels';
import { getGeminiModelLabel } from '../../../services/gemini/modelDiscovery';
import {
  getSubtitleGroupingModel,
  SUBTITLE_GROUPING_MODEL_STORAGE_KEY
} from '../../../services/gemini/subtitleGroupingModel';

const SubtitleGroupingModelSelect = ({ disabled = false, onModelChange }) => {
  const { t } = useTranslation();
  const { models, isLoading } = useGeminiModels();
  const [selectedModel, setSelectedModel] = useState(getSubtitleGroupingModel);
  const onModelChangeRef = useRef(onModelChange);
  onModelChangeRef.current = onModelChange;

  useEffect(() => {
    if (!models.length || models.some(model => model.id === selectedModel)) return;

    const configuredModel = localStorage.getItem('gemini_model');
    const nextModel = models.find(model => model.id === configuredModel)?.id || models[0]?.id;
    if (!nextModel || nextModel === selectedModel) return;

    localStorage.setItem(SUBTITLE_GROUPING_MODEL_STORAGE_KEY, nextModel);
    setSelectedModel(nextModel);
    onModelChangeRef.current?.(nextModel);
  }, [models, selectedModel]);

  const handleChange = (event) => {
    const modelId = event.target.value;
    if (!modelId || modelId === selectedModel) return;

    localStorage.setItem(SUBTITLE_GROUPING_MODEL_STORAGE_KEY, modelId);
    setSelectedModel(modelId);
    onModelChangeRef.current?.(modelId);
  };

  return (
    <div className="grouping-model-container">
      <label htmlFor="subtitle-grouping-model" className="grouping-intensity-label">
        {t('narration.groupingModel', 'Grouping Model')}:
      </label>
      <select
        id="subtitle-grouping-model"
        className="grouping-intensity-select grouping-model-select"
        value={selectedModel}
        onChange={handleChange}
        disabled={disabled || isLoading || models.length === 0}
        title={t('narration.groupingModelChangeTooltip', 'Changing the model requires regrouping subtitles')}
      >
        {models.map(model => (
          <option value={model.id} key={model.id}>{getGeminiModelLabel(model)}</option>
        ))}
      </select>
    </div>
  );
};

export default SubtitleGroupingModelSelect;
