import { useCallback, useEffect, useState } from 'react';
import {
  getUsableGeminiModels,
  getCachedGeminiModelResult,
  getDefaultGeminiModels
} from '../services/gemini/modelDiscovery';
import { getCurrentKey } from '../services/gemini/keyManager';

const getSelectableModels = () => {
  const cachedResult = getCachedGeminiModelResult(getCurrentKey());
  return cachedResult ? cachedResult.usableModels : getDefaultGeminiModels();
};

export const useGeminiModels = () => {
  const [models, setModels] = useState(getSelectableModels);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(() => {
    const cachedResult = getCachedGeminiModelResult(getCurrentKey());
    return cachedResult && cachedResult.usableModels.length === 0
      ? new Error('No verified Gemini translation models are available')
      : null;
  });

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const discovered = await getUsableGeminiModels({ force: true });
      setModels(discovered);
      setError(discovered.length > 0 ? null : new Error('No verified Gemini translation models are available'));
      return discovered;
    } catch (discoveryError) {
      setError(discoveryError);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleKeyChange = () => {
      const selectableModels = getSelectableModels();
      const cachedResult = getCachedGeminiModelResult(getCurrentKey());
      setModels(selectableModels);
      setError(cachedResult && cachedResult.usableModels.length === 0
        ? new Error('No verified Gemini translation models are available')
        : null);
      setIsLoading(false);
    };

    window.addEventListener('gemini-api-key-changed', handleKeyChange);
    window.addEventListener('gemini-models-checked', handleKeyChange);

    return () => {
      window.removeEventListener('gemini-api-key-changed', handleKeyChange);
      window.removeEventListener('gemini-models-checked', handleKeyChange);
    };
  }, []);

  return { models, isLoading, error, refresh };
};
