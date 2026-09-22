import { useCallback, useEffect, useState } from 'react';
import { getUsableGeminiModels } from '../services/gemini/modelDiscovery';

export const useGeminiModels = () => {
  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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
    let active = true;
    const handleKeyChange = () => {
      refresh();
    };

    getUsableGeminiModels()
      .then((discovered) => {
        if (active) {
          setModels(discovered);
          setError(discovered.length > 0 ? null : new Error('No verified Gemini translation models are available'));
        }
      })
      .catch((discoveryError) => {
        if (active) setError(discoveryError);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    window.addEventListener('gemini-api-key-changed', handleKeyChange);

    return () => {
      active = false;
      window.removeEventListener('gemini-api-key-changed', handleKeyChange);
    };
  }, [refresh]);

  return { models, isLoading, error, refresh };
};
