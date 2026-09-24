import { useEffect } from 'react';
import { checkNarrationStatusWithRetry } from '../../../services/narrationService';
import { checkChatterboxAvailability as checkOmniVoiceAvailability } from '../../../services/chatterboxService';

/**
 * Check OmniVoice availability through its local health endpoint.
 * @returns {Promise<{available: boolean, message?: string}>}
 */
const checkChatterboxAvailability = async () => {
  const status = await checkOmniVoiceAvailability(3, 2000, false);
  return status.available
    ? status
    : { ...status, message: status.message || 'OmniVoice chưa sẵn sàng. Hãy cài dependency TTS và khởi động lại worker.' };
};

/**
 * Custom hook for checking narration service availability
 * @param {Object} params - Parameters
 * @param {string} params.narrationMethod - Current narration method
 * @param {Function} params.setIsAvailable - Function to set VieNeu-TTS availability
 * @param {Function} params.setIsChatterboxAvailable - Function to set OmniVoice availability
 * @param {Function} params.setError - Function to set error message
 * @param {Function} params.t - Translation function
 * @returns {void}
 */
const useAvailabilityCheck = ({
  narrationMethod,
  setIsAvailable,
  setIsChatterboxAvailable,
  setError,
  t
}) => {
  // Check if narration services are available
  useEffect(() => {
    if (narrationMethod === 'capcut') { setError(''); return; }
    const checkAvailability = async () => {
      try {
        // First, do immediate checks for services that can be determined quickly

        const f5Status = await checkNarrationStatusWithRetry();

        // Set F5-TTS availability based on the actual status
        setIsAvailable(f5Status.available);

        // Check OmniVoice availability through its health endpoint.
        const chatterboxStatus = await checkChatterboxAvailability();
        setIsChatterboxAvailable(chatterboxStatus.available);

        // Set error message based on current method
        if (!f5Status.available && narrationMethod === 'f5tts' && f5Status.message) {
          setError(f5Status.message);
        }
        else if (!chatterboxStatus.available && narrationMethod === 'chatterbox' && chatterboxStatus.message) {
          setError(chatterboxStatus.message);
        }
        else {
          // Clear any previous errors
          setError('');
        }
      } catch (error) {
        console.error('Error checking service availability:', error);

        // Set error based on current method
        if (narrationMethod === 'f5tts') {
          setIsAvailable(false);
          setError(t('narration.serviceUnavailableMessage', "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."));
        }
        else if (narrationMethod === 'chatterbox') {
          // Set Chatterbox as unavailable when not running with dev:cuda
          setIsChatterboxAvailable(false);
          setError(t('narration.serviceUnavailableMessage', "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."));
        }
        else {
          setIsAvailable(false);
          setIsChatterboxAvailable(false);
          setError(t('narration.serviceUnavailableMessage', 'Cài VieNeu-TTS và OmniVoice rồi khởi động lại dịch vụ thuyết minh.'));
        }
      }
    };

    // Check availability once when component mounts or narration method changes
    checkAvailability();
  }, [t, narrationMethod, setIsAvailable, setIsChatterboxAvailable, setError]);
};

export default useAvailabilityCheck;
