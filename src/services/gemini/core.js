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
import { resolveGeminiModel } from './modelDiscovery';

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
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiApiKey}`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(requestData),
                        signal: signal
                    }
                );

                if (!response.ok) {
                    try {
                        const errorData = await response.json();

                        // Check for 503 status code in the early return path
                        if (errorData.error?.code === 503 || response.status === 503) {
                            blacklistKey(geminiApiKey);
                            const overloadError = new Error(i18n.t('errors.geminiServiceUnavailable', 'Gemini is currently overloaded, please wait and try again later (error code 503)'));
                            overloadError.isOverloaded = true;
                            throw overloadError;
                        }

                        throw new Error(`API error: ${errorData.error?.message || response.statusText}`);
                    } catch (jsonError) {
                        // Check for 503 status code when JSON parsing fails
                        if (response.status === 503) {
                            blacklistKey(geminiApiKey);
                            const overloadError = new Error(i18n.t('errors.geminiServiceUnavailable', 'Gemini is currently overloaded, please wait and try again later (error code 503)'));
                            overloadError.isOverloaded = true;
                            throw overloadError;
                        }

                        throw new Error(`API error: ${response.statusText}. Status code: ${response.status}`);
                    }
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
                if (error.name === 'AbortError') {

                    throw new Error('Request was aborted');
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


        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiApiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData),
                signal: signal
            }
        );

        if (!response.ok) {
            try {
                // Clone the response before reading it to avoid the "body stream already read" error
                const responseClone = response.clone();
                try {
                    const errorData = await response.json();
                    console.error('Gemini API error details:', errorData);

                    // Log more detailed information about the error
                    if (errorData.error) {
                        console.error('Error code:', errorData.error.code);
                        console.error('Error message:', errorData.error.message);
                        console.error('Error status:', errorData.error.status);

                        // Check for specific error messages related to audio/video processing
                        if (errorData.error.message.includes('invalid argument')) {
                            console.error('This may be due to an unsupported file format or MIME type');
                            console.error('Supported audio formats: audio/wav, audio/mp3, audio/aiff, audio/aac, audio/ogg, audio/flac');
                            console.error('File type used:', input.type);
                        }

                        // Check for overload errors (503 status code)
                        if (errorData.error.code === 503 ||
                            errorData.error.status === 'UNAVAILABLE' ||
                            errorData.error.message.includes('overloaded')) {
                            // Blacklist the current API key
                            blacklistKey(geminiApiKey);
                            const overloadError = new Error(i18n.t('errors.geminiServiceUnavailable', 'Gemini is currently overloaded, please wait and try again later (error code 503)'));
                            overloadError.isOverloaded = true;
                            throw overloadError;
                        }

                        // Check for quota exceeded errors (429 status code)
                        if (errorData.error.code === 429 ||
                            errorData.error.status === 'RESOURCE_EXHAUSTED' ||
                            (errorData.error.message && errorData.error.message.includes('quota'))) {
                            // Blacklist the current API key
                            blacklistKey(geminiApiKey);
                            throw new Error(i18n.t('errors.apiQuotaExceeded', 'Current API key is overloaded, please use a key from another Gmail account, or wait for some time, or add billing at https://aistudio.google.com/usage?tab=billing'));
                        }
                    }

                    throw new Error(`API error: ${errorData.error?.message || response.statusText}`);
                } catch (jsonError) {
                    console.error('Error parsing Gemini API error response as JSON:', jsonError);
                    const errorText = await responseClone.text();
                    console.error('Raw error response:', errorText);

                    // Check for 503 status code directly
                    if (response.status === 503) {
                        // Blacklist the current API key
                        blacklistKey(geminiApiKey);
                        const overloadError = new Error(i18n.t('errors.geminiServiceUnavailable', 'Gemini is currently overloaded, please wait and try again later (error code 503)'));
                        overloadError.isOverloaded = true;
                        throw overloadError;
                    }

                    // Check for 429 status code (quota exceeded)
                    if (response.status === 429) {
                        // Blacklist the current API key
                        blacklistKey(geminiApiKey);
                        throw new Error(i18n.t('errors.apiQuotaExceeded', 'Current API key is overloaded, please use a key from another Gmail account, or wait for some time, or add billing at https://aistudio.google.com/usage?tab=billing'));
                    }

                    // Check for 503 status code before throwing generic error
                    if (response.status === 503) {
                        blacklistKey(geminiApiKey);
                        const overloadError = new Error(i18n.t('errors.geminiServiceUnavailable', 'Gemini is currently overloaded, please wait and try again later (error code 503)'));
                        overloadError.isOverloaded = true;
                        throw overloadError;
                    }

                    throw new Error(`API error: ${response.statusText}. Status code: ${response.status}`);
                }
            } catch (error) {
                console.error('Error handling Gemini API error response:', error);

                // Check for 503 status code directly
                if (response.status === 503) {
                    // Blacklist the current API key
                    blacklistKey(geminiApiKey);
                    const overloadError = new Error(i18n.t('errors.geminiServiceUnavailable', 'Gemini is currently overloaded, please wait and try again later (error code 503)'));
                    overloadError.isOverloaded = true;
                    throw overloadError;
                }

                // Check for 429 status code (quota exceeded)
                if (response.status === 429) {
                    // Blacklist the current API key
                    blacklistKey(geminiApiKey);
                    throw new Error(i18n.t('errors.apiQuotaExceeded', 'Current API key is overloaded, please use a key from another Gmail account, or wait for some time, or add billing at https://aistudio.google.com/usage?tab=billing'));
                }

                // Check for 503 status code before throwing generic error
                if (response.status === 503) {
                    blacklistKey(geminiApiKey);
                    const overloadError = new Error(i18n.t('errors.geminiServiceUnavailable', 'Gemini is currently overloaded, please wait and try again later (error code 503)'));
                    overloadError.isOverloaded = true;
                    throw overloadError;
                }

                throw new Error(`API error: ${response.statusText}. Status code: ${response.status}`);
            }
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
        if (error.name === 'AbortError') {

            throw new Error('Request was aborted');
        } else {
            console.error('Error calling Gemini API:', error);

            // Check for overload errors in the error message
            if (error.message && (
                error.message.includes('503') ||
                error.message.includes('Service Unavailable') ||
                error.message.includes('overloaded') ||
                error.message.includes('UNAVAILABLE')
            )) {
                // Blacklist the current API key
                blacklistKey(geminiApiKey);

                if (!error.isOverloaded) {
                    error.isOverloaded = true;
                }

                // Replace the error message with a user-friendly localized message
                error = new Error(i18n.t('errors.geminiServiceUnavailable', 'Gemini is currently overloaded, please wait and try again later (error code 503)'));
                error.isOverloaded = true;
            }

            // Check for quota exceeded errors in the error message
            if (error.message && (
                error.message.includes('429') ||
                error.message.includes('quota') ||
                error.message.includes('RESOURCE_EXHAUSTED')
            )) {
                // Blacklist the current API key
                blacklistKey(geminiApiKey);

                // Replace the error with a more specific user-friendly message
                error = new Error(i18n.t('errors.apiQuotaExceeded', 'Current API key is overloaded, please use a key from another Gmail account, or wait for some time, or add billing at https://aistudio.google.com/usage?tab=billing'));
            }

            // Remove this controller from the map on error
            if (requestId) {
                removeRequestController(requestId);
            }
            throw error;
        }
    }
};
