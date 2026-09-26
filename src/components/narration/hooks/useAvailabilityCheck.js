import { useEffect } from 'react';
import { checkNarrationStatusWithRetry } from '../../../services/narrationService';
import { checkOmniVoiceAvailability } from '../../../services/chatterboxService';
import { NARRATION_METHODS } from '../narrationMethods';

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

const getServiceState = (status, engineState) => {
  if (!status?.available) return 'unavailable';
  if (status.ready) return 'ready';
  if (status.loading || engineState === 'loading') return 'loading';
  if (status.initialization_error || engineState === 'error') return 'error';
  return 'starting';
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
  setVieneuStatus,
  setOmnivoiceStatus,
  setError,
  t
}) => {
  // Check if narration services are available
  useEffect(() => {
    let cancelled = false;
    let checking = false;
    let initialCheck = true;

    const checkAvailability = async () => {
      if (checking) return;
      checking = true;
      try {
        const f5Status = await checkNarrationStatusWithRetry();
        const chatterboxStatus = await checkChatterboxAvailability();

        if (cancelled) return;

        const vieneuState = getServiceState(f5Status, f5Status.state);
        const omnivoiceState = getServiceState(chatterboxStatus, chatterboxStatus.state || chatterboxStatus.model_state);
        const vieneuUsable = Boolean(f5Status.available && vieneuState !== 'error');
        const omnivoiceUsable = Boolean(chatterboxStatus.available && omnivoiceState !== 'error');

        setVieneuStatus(vieneuState);
        setOmnivoiceStatus(omnivoiceState);
        setIsAvailable(vieneuUsable);
        setIsChatterboxAvailable(omnivoiceUsable);

        // Set error message based on current method
        if (!vieneuUsable && narrationMethod === NARRATION_METHODS.VIENEU && f5Status.message) {
          setError(f5Status.message);
        }
        else if (!omnivoiceUsable && narrationMethod === NARRATION_METHODS.OMNIVOICE && chatterboxStatus.message) {
          setError(chatterboxStatus.message);
        }
        else if (initialCheck) {
          // Clear any previous errors
          setError('');
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Error checking service availability:', error);

        setVieneuStatus('unavailable');
        setOmnivoiceStatus('unavailable');
        setIsAvailable(false);
        setIsChatterboxAvailable(false);

        // Set error based on current method
        if (narrationMethod === NARRATION_METHODS.VIENEU) {
          setIsAvailable(false);
          setError(t('narration.serviceUnavailableMessage', "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."));
        }
        else if (narrationMethod === NARRATION_METHODS.OMNIVOICE) {
          // Set Chatterbox as unavailable when not running with dev:cuda
          setIsChatterboxAvailable(false);
          setError(t('narration.serviceUnavailableMessage', "Vui lòng chạy ứng dụng bằng npm run dev:cuda để dùng chức năng Thuyết minh. Nếu đã chạy bằng npm run dev:cuda, vui lòng đợi khoảng 1 phút sẽ dùng được."));
        }
        else {
          setIsAvailable(false);
          setIsChatterboxAvailable(false);
          setError(t('narration.serviceUnavailableMessage', 'Cài VieNeu-TTS và OmniVoice rồi khởi động lại dịch vụ thuyết minh.'));
        }
      } finally {
        checking = false;
        initialCheck = false;
      }
    };

    // Check both local engines regardless of the currently selected narration method.
    checkAvailability();
    const pollingId = setInterval(checkAvailability, 5000);

    return () => {
      cancelled = true;
      clearInterval(pollingId);
    };
  }, [t, narrationMethod, setIsAvailable, setIsChatterboxAvailable, setVieneuStatus, setOmnivoiceStatus, setError]);
};

export default useAvailabilityCheck;
