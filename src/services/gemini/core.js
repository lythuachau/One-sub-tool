/**
 * Core functionality for Gemini API
 */

import { parseGeminiResponse } from '../../utils/subtitle';
import { convertAudioForGemini, isAudioFormatSupportedByGemini } from '../../utils/audioConverter';
import {
    createSubtitleSchema,
    addResponseSchema
} from '../../utils/schemaUtils';
import { getTranscriptionPrompt } from './promptManagement';
import { fileToBase64 } from './utils';
import {
    createRequestController,
    removeRequestController
} from './requestManagement';
import i18n from '../../i18n/i18n';
import { getNextAvailableKey, blacklistKey } from './keyManager';
import { addThinkingConfig } from '../../utils/thinkingBudgetUtils';
import { persistGeminiModelFallback, resolveGeminiModel } from './modelDiscovery';
import { createGeminiApiError } from './errorUtils';
import { requestGeminiWithModelFallback } from './modelRequest';

/**
 * Call the Gemini API with various input types
 * @param {File|string} input - Input file or URL
 * @param {string} inputType - Type of input (youtube, video, audio, file-upload)
 * @param {Object} options - Additional options
 * @returns {Promise<Array>} - Array of subtitles
 */
export const callGeminiApi = async (input, inputType, options = {}) => {
    // Extract options
    const { userProvidedSubtitles, modelId } = options;
    // Resolve the selected model against the models currently available to the active API key.
    const requestedModel = modelId || localStorage.getItem('gemini_model') || '';

    // Resolve the model against the same key that will send the request.
    const geminiApiKey = getNextAvailableKey();
    if (!geminiApiKey) {
        throw new Error('No valid Gemini API key available. Please add at least one API key in Settings.');
    }

    const MODEL = await resolveGeminiModel(requestedModel, geminiApiKey);

    if (requestedModel !== MODEL) {
        console.warn(`[GeminiAPI] Model ${requestedModel || '(default)'} is unavailable; using ${MODEL}`);
        persistGeminiModelFallback(requestedModel, MODEL, ['gemini_model', 'video_processing_model']);
    } else if (modelId) {
        console.log(`[GeminiAPI] Using custom model: ${MODEL}`);
    }

    let requestData = {
        model: MODEL,
        contents: []
    };

    // Always use structured output, but with different schema based on whether we have user-provided subtitles
    const isUserProvided = userProvidedSubtitles && userProvidedSubtitles.trim() !== '';
    requestData = addResponseSchema(requestData, createSubtitleSchema(isUserProvided), isUserProvided);

    // Add thinking configuration if supported by the model
    requestData = addThinkingConfig(requestData, MODEL);


    if (inputType === 'youtube') {
        requestData.contents = [
            {
                role: "user",
                parts: [
                    { text: getTranscriptionPrompt('video') },
                    {
                        fileData: {
                            fileUri: input
                        }
                    }
                ]
            }
        ];
    } else if (inputType === 'video' || inputType === 'audio' || inputType === 'file-upload') {
        // Determine if this is a video or audio file
        const isAudio = input.type.startsWith('audio/');
        const contentType = isAudio ? 'audio' : 'video';

        // For audio files, convert to a format supported by Gemini
        let processedInput = input;
        if (isAudio) {




            // Check if the audio format is supported by Gemini
            if (!isAudioFormatSupportedByGemini(input)) {
                console.warn('Audio format not directly supported by Gemini API, attempting conversion');
            }

            // Convert the audio file to a supported format
            processedInput = await convertAudioForGemini(input);

        }

        const base64Data = await fileToBase64(processedInput);

        // Use the MIME type from the processed input
        const mimeType = processedInput.type;



        // Check if we have user-provided subtitles
        const isUserProvided = userProvidedSubtitles && userProvidedSubtitles.trim() !== '';

        // Extract segment information if available
        const segmentInfo = options?.segmentInfo || {};

        // For audio files, we need to ensure the prompt is appropriate
        const promptText = getTranscriptionPrompt(contentType, userProvidedSubtitles, { segmentInfo });

        // Log the prompt being used


        // Log if we're using user-provided subtitles
        if (isUserProvided) {


            // When using user-provided subtitles, we want to use a very simple request
            // without any additional configuration or schema
            requestData = {
                model: MODEL,
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: promptText },
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Data
                                }
                            }
                        ]
                    }
                ]
            };

            // Still add the structured output schema, but with the user-provided flag
            requestData = addResponseSchema(requestData, createSubtitleSchema(true), true);

            // Add thinking configuration if supported by the model
            requestData = addThinkingConfig(requestData, MODEL);


            // Count the number of subtitles for validation
            const subtitleLines = userProvidedSubtitles.trim().split('\n').filter(line => line.trim() !== '');
            const expectedSubtitleCount = subtitleLines.length;


            // Store user-provided subtitles in localStorage for the parser to access
            localStorage.setItem('user_provided_subtitles', userProvidedSubtitles);


            // Skip the rest of the function since we've already set up the request data


            // Log the MIME type being sent to the API


            // Return early to skip the rest of the function
            // Use the same API call logic as below but in a more direct way
            const { requestId, signal } = createRequestController();

            try {
                const { response, model: responseModel } = await requestGeminiWithModelFallback({
                    model: MODEL,
                    apiKey: geminiApiKey,
                    requestData,
                    signal,
                    storageKeys: ['gemini_model', 'video_processing_model']
                });

                if (!response.ok) {
                    const apiError = await createGeminiApiError(response, responseModel);
                    if (apiError.isQuotaError || apiError.isOverloaded) {
                        blacklistKey(geminiApiKey);
                    }
                    throw apiError;
                }

                const data = await response.json();

                // For user-provided subtitles, validate the response
                if (isUserProvided && data?.candidates?.[0]?.content?.parts?.[0]?.structuredJson) {
                    const structuredJson = data.candidates[0].content.parts[0].structuredJson;
                    if (Array.isArray(structuredJson)) {


                        // For segments, we expect a variable number of entries
                        const isSegment = options?.segmentInfo?.isSegment || false;

                        if (!isSegment) {
                            // For full video processing, we expect entries for all subtitles
                            // But we'll be more flexible and just log a warning if the counts don't match
                            if (structuredJson.length !== expectedSubtitleCount) {
                                console.warn(`Warning: Expected ${expectedSubtitleCount} timing entries but got ${structuredJson.length}`);
                            }
                        }

                        // Validate that all entries have the required fields
                        for (const entry of structuredJson) {
                            if (!entry.index && entry.index !== 0) {
                                console.error('Missing index in timing entry:', entry);
                                throw new Error('Invalid timing entry: missing index');
                            }
                            if (!entry.startTime) {
                                console.error('Missing startTime in timing entry:', entry);
                                throw new Error('Invalid timing entry: missing startTime');
                            }
                            if (!entry.endTime) {
                                console.error('Missing endTime in timing entry:', entry);
                                throw new Error('Invalid timing entry: missing endTime');
                            }
                        }
                    }
                }

                // Remove this controller from the map after successful response
                removeRequestController(requestId);
                return parseGeminiResponse(data);
            } catch (error) {
                // Check if this is an AbortError
                if (error.name === 'AbortError' || signal.aborted) {
                    const abortError = new Error('Request was aborted');
                    abortError.name = 'AbortError';
                    throw abortError;
                } else {
                    console.error('Error calling Gemini API:', error);
                    // Remove this controller from the map on error
                    removeRequestController(requestId);
                    throw error;
                }
            }
        }

        requestData.contents = [
            {
                role: "user",
                parts: [
                    { text: promptText },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    }
                ]
            }
        ];

        // Log the MIME type being sent to the API

    }

    // Create a unique ID for this request
    const { requestId, signal } = createRequestController();

    try {
        // Log request data for debugging (without the actual base64 data to keep logs clean)



        // Create a deep copy of the request data for logging
        const debugRequestData = JSON.parse(JSON.stringify(requestData));
        if (debugRequestData.contents && debugRequestData.contents[0] && debugRequestData.contents[0].parts) {
            for (let i = 0; i < debugRequestData.contents[0].parts.length; i++) {
                const part = debugRequestData.contents[0].parts[i];
                if (part.inlineData && part.inlineData.data) {
                    debugRequestData.contents[0].parts[i] = {
                        ...part,
                        inlineData: {
                            ...part.inlineData,
                            data: '[BASE64_DATA]'
                        }
                    };
                }
            }
        }


        const { response, model: responseModel } = await requestGeminiWithModelFallback({
            model: MODEL,
            apiKey: geminiApiKey,
            requestData,
            signal,
            storageKeys: ['gemini_model', 'video_processing_model']
        });

        if (!response.ok) {
            const apiError = await createGeminiApiError(response, responseModel);
            if (apiError.isQuotaError || apiError.isOverloaded) {
                blacklistKey(geminiApiKey);
            }
            throw apiError;
        }

        const data = await response.json();


        // Check if the response contains empty subtitles
        if (data?.candidates?.[0]?.content?.parts?.[0]?.structuredJson) {
            const structuredJson = data.candidates[0].content.parts[0].structuredJson;
            if (Array.isArray(structuredJson)) {
                let emptyCount = 0;
                for (const item of structuredJson) {
                    if (item.startTime === '00m00s000ms' &&
                        item.endTime === '00m00s000ms' &&
                        (!item.text || item.text.trim() === '')) {
                        emptyCount++;
                    }
                }

                if (emptyCount > 0 && emptyCount / structuredJson.length > 0.9) {
                    console.warn(`Found ${emptyCount} empty subtitles out of ${structuredJson.length}. The audio may not contain any speech or the model failed to transcribe it.`);

                    if (emptyCount === structuredJson.length) {
                        throw new Error('No speech detected in the audio. The model returned empty subtitles.');
                    }
                }
            }
        }

        // Print the raw response to the console for debugging
        console.log('Raw Gemini API response:', JSON.stringify(data, null, 2));

        // Check if content was blocked by Gemini
        if (data?.promptFeedback?.blockReason) {
            console.error('Content blocked by Gemini:', data.promptFeedback);
            // Remove this controller from the map
            removeRequestController(requestId);
            throw new Error(i18n.t('errors.contentBlocked', 'Video content is not safe and was blocked by Gemini'));
        }

        // Remove this controller from the map after successful response
        removeRequestController(requestId);
        return parseGeminiResponse(data);
    } catch (error) {
        // Check if this is an AbortError
        if (error.name === 'AbortError' || signal.aborted) {
            const abortError = new Error('Request was aborted');
            abortError.name = 'AbortError';
            throw abortError;
        } else {
            console.error('Error calling Gemini API:', error);
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            const errorMessage = normalizedError.message || '';

            if (normalizedError.isOverloaded || /503|service unavailable|overloaded|unavailable/i.test(errorMessage)) {
                blacklistKey(geminiApiKey);
                normalizedError.isOverloaded = true;
            }

            if (normalizedError.isQuotaError || /429|quota|resource.?exhausted|rate.?limit/i.test(errorMessage)) {
                blacklistKey(geminiApiKey);
                normalizedError.isQuotaError = true;
            }

            // Remove this controller from the map on error
            if (requestId) {
                removeRequestController(requestId);
            }
            throw normalizedError;
        }
    }
};
