/**
 * Service for grouping subtitles into fuller sentences for better narration
 * Uses Gemini API to intelligently combine subtitle lines
 */

// import { addResponseSchema } from '../../utils/schemaUtils'; // No longer needed if schema is removed
import { resolveGeminiModel } from './modelDiscovery';
import { fetchGemini } from './requestManagement';
import { getSubtitleGroupingModel } from './subtitleGroupingModel';

const MAX_GROUP_GAP_SECONDS = 0.35;
const MAX_GROUP_SIZE_BY_INTENSITY = {
  minimal: 2,
  light: 3,
  balanced: 4,
  moderate: 4,
  enhanced: 5,
  aggressive: 7
};

const getSubtitleId = (subtitle, index) => subtitle.subtitle_id ?? subtitle.id ?? index + 1;

const parseSubtitleTime = (value) => {
  if (Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === '') return null;

  const normalized = String(value).trim().replace(',', '.');
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return Number(normalized);

  const parts = normalized.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
};

const getSubtitleStart = (subtitle) => parseSubtitleTime(subtitle.start ?? subtitle.startTime ?? subtitle.start_time);
const getSubtitleEnd = (subtitle) => parseSubtitleTime(subtitle.end ?? subtitle.endTime ?? subtitle.end_time);

const canJoinSubtitleGroup = (previous, next) => {
  const previousEnd = getSubtitleEnd(previous);
  const nextStart = getSubtitleStart(next);
  if (previousEnd === null || nextStart === null) return false;
  return nextStart - previousEnd <= MAX_GROUP_GAP_SECONDS;
};

const createFallbackGroupMapping = (subtitles, maxGroupSize) => {
  const groups = {};
  let currentGroup = [];
  let groupId = 1;

  subtitles.forEach((subtitle, index) => {
    if (currentGroup.length > 0 &&
        (!canJoinSubtitleGroup(subtitles[index - 1], subtitle) || currentGroup.length >= maxGroupSize)) {
      groups[String(groupId++)] = currentGroup;
      currentGroup = [];
    }

    currentGroup.push(getSubtitleId(subtitle, index));
  });

  if (currentGroup.length > 0) groups[String(groupId)] = currentGroup;
  return groups;
};

const enforceSafeGroupMapping = (subtitles, groupMapping, maxGroupSize) => {
  const sourceIds = subtitles.map((subtitle, index) => getSubtitleId(subtitle, index));
  const indexById = new Map(sourceIds.map((id, index) => [String(id), index]));
  const proposedGroupByIndex = new Map();

  Object.entries(groupMapping || {}).forEach(([groupId, ids]) => {
    if (!Array.isArray(ids)) return;
    ids.forEach(id => {
      const index = indexById.get(String(id));
      if (index !== undefined && !proposedGroupByIndex.has(index)) {
        proposedGroupByIndex.set(index, groupId);
      }
    });
  });

  const safeGroups = [];
  let currentGroup = [];
  let currentProposal = null;

  const flushGroup = () => {
    if (currentGroup.length > 0) safeGroups.push(currentGroup);
    currentGroup = [];
    currentProposal = null;
  };

  subtitles.forEach((subtitle, index) => {
    const proposal = proposedGroupByIndex.get(index);
    const previousSubtitle = subtitles[index - 1];
    const isSafeToAppend = currentGroup.length > 0 &&
      proposal !== undefined && proposal === currentProposal &&
      indexById.get(String(currentGroup[currentGroup.length - 1])) === index - 1 &&
      currentGroup.length < maxGroupSize &&
      canJoinSubtitleGroup(previousSubtitle, subtitle);

    if (!isSafeToAppend) flushGroup();
    currentGroup.push(sourceIds[index]);
    currentProposal = proposal;
  });
  flushGroup();

  return safeGroups.reduce((mapping, ids, index) => {
    mapping[String(index + 1)] = ids;
    return mapping;
  }, {});
};

/**
 * Group subtitles into fuller sentences for better narration
 * @param {Array} subtitles - Array of subtitle objects
 * @param {string} language - Language code of the subtitles
 * @param {string} model - Gemini model to use
 * @param {string} intensity - Grouping intensity level (minimal, moderate, aggressive)
 * @returns {Promise<Object>} - Object with grouped subtitles and mapping
 */
export const groupSubtitlesForNarration = async (subtitles, language = 'en', model = '', intensity = 'moderate') => {
  if (!subtitles || subtitles.length === 0) {
    return {
      success: false,
      error: 'No subtitles provided',
      groupedSubtitles: [],
      groupMapping: {}
    };
  }

  try {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      throw new Error('Gemini API key not found');
    }

    model = await resolveGeminiModel(model || getSubtitleGroupingModel());

    const subtitleText = subtitles.map((sub, index) => {
      const start = getSubtitleStart(sub);
      const end = getSubtitleEnd(sub);
      const timing = start !== null && end !== null
        ? `${start.toFixed(3)}-${end.toFixed(3)} seconds`
        : 'unknown';
      return `ID: ${JSON.stringify(getSubtitleId(sub, index))}, Time: ${timing}, Text: ${JSON.stringify(sub.text || '')}`;
    }).join('\n');

    const maxOutputTokens = 8192;
    const maxGroupSize = MAX_GROUP_SIZE_BY_INTENSITY[intensity] || MAX_GROUP_SIZE_BY_INTENSITY.moderate;

    // Define grouping intensity guidelines
    let intensityGuidelines = '';

    switch (intensity) {
      case 'minimal':
        intensityGuidelines = `
Grouping Intensity: MINIMAL
- Be extremely conservative in grouping subtitles.
- Only combine subtitles that are clearly part of the same incomplete sentence.
- Prioritize keeping subtitles separate unless they absolutely need to be combined.
- Aim for very small groups of 1-2 subtitles at most.
- When in doubt, always keep subtitles separate.`;
        break;
      case 'light':
        intensityGuidelines = `
Grouping Intensity: LIGHT
- Be conservative in grouping subtitles.
- Combine subtitles only when they clearly form part of the same sentence.
- Prefer smaller groups over larger ones.
- Aim for small groups of 2-3 subtitles at most.
- Maintain frequent breaks between groups.`;
        break;
      case 'balanced':
        intensityGuidelines = `
Grouping Intensity: BALANCED
- Find a middle ground between light and moderate grouping.
- Combine subtitles that are likely part of the same sentence or closely related thoughts.
- Create groups that balance readability with natural flow.
- Aim for groups of 2-4 subtitles, favoring the lower end when in doubt.
- Pay close attention to natural speech patterns and pauses.`;
        break;
      case 'moderate':
      default:
        intensityGuidelines = `
Grouping Intensity: MODERATE
- Balance between keeping subtitles separate and combining them.
- Combine subtitles that form part of the same thought or sentence.
- Create natural groupings that sound good when read aloud.
- Aim for groups of 3-4 subtitles on average.
- Respect natural pauses and topic changes.`;
        break;
      case 'enhanced':
        intensityGuidelines = `
Grouping Intensity: ENHANCED
- Be somewhat liberal in grouping subtitles.
- Actively look for opportunities to combine related subtitles.
- Create fuller, more complete sentences where possible.
- Aim for groups of 4-5 subtitles on average.
- Maintain flow between related thoughts.`;
        break;
      case 'aggressive':
        intensityGuidelines = `
Grouping Intensity: AGGRESSIVE
- Be very liberal in grouping subtitles.
- Combine as many subtitles as possible into coherent units.
- Look for opportunities to create longer, more complete thoughts.
- Aim for larger groups of 5-7 subtitles where possible.
- Only create breaks when there's a clear topic change or natural pause.`;
        break;
    }

    const groupingPrompt = `
You are an expert in natural language processing. Your task is to group the following subtitles into fuller, more coherent sentences for narration purposes.

Each subtitle line may only contain a few words, which is suitable for displaying as subtitles but not ideal for generating narration. Combine only consecutive subtitles that form one coherent spoken phrase.

Timing safety rules:
- Preserve the exact input order. Every group must contain a continuous range of adjacent input rows; never skip an ID and join rows around it.
- Never combine subtitles across a pause longer than ${MAX_GROUP_GAP_SECONDS} seconds between the previous subtitle's end and the next subtitle's start.
- Keep any subtitle with unknown timing in its own group.
- Do not merge a later subtitle into an earlier group just to form a longer sentence; the narration must not speak its text before that subtitle appears in the video.
- Use no more than ${maxGroupSize} subtitles per group.

${intensityGuidelines}

General Guidelines:
1. Each original subtitle should appear in exactly one group.
2. Maintain the original order of subtitles.
3. Group IDs should be strings (e.g., "1", "2", ..., "N").

Subtitles:
${subtitleText}

IMPORTANT: You must respond with a JSON object in the following exact format:
{
  "groups": {
    "1": ["ID from input", "ID from input"],
    "2": ["ID from input"],
    "3": ["ID from input"]
  }
}

Where:
- The outer object has a single "groups" property.
- Inside "groups", each key is a new group ID (a string, starting from "1" and incrementing sequentially).
- Each value is an array of original subtitle IDs that should be combined. These IDs must match the IDs provided in the input subtitles.

DO NOT include any explanations, comments, or any other text in your response. Return ONLY the JSON object.
`;

    let requestData = {
      contents: [
        {
          role: "user",
          parts: [
            { text: groupingPrompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        topK: 32,
        topP: 0.95,
        maxOutputTokens: maxOutputTokens,
        // REMOVED: responseMimeType: "application/json",
        // REMOVED: responseSchema: createSubtitleGroupingSchema()
      },
    };

    // REMOVED: requestData = addResponseSchema(requestData, createSubtitleGroupingSchema());

    console.log('Final requestData being sent to Gemini API (no schema):', JSON.stringify(requestData, null, 2));
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    console.log('Calling Gemini API for subtitle grouping (no schema)...');

    const responseData = await (async () => {
      try {
        const response = await fetchGemini(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', },
          body: JSON.stringify(requestData)
        });

        if (!response.ok) {
          const errorBodyText = await response.text();
          let errorData;
          try { errorData = JSON.parse(errorBodyText); }
          catch (e) { errorData = { error: { message: `Non-JSON error response (status ${response.status}): ${errorBodyText}` } }; }
          console.error('Gemini API error response (raw):', errorBodyText);
          throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
        }
        const data = await response.json();
        console.log('Received response from Gemini API for subtitle grouping');
        return data;
      } catch (error) {
        console.error('Error during Gemini API call:', error);
        throw error;
      }
    })();

    let groupMapping = {};
    try {
      console.log('Parsing response for subtitle grouping');
      // With no responseSchema, we will always rely on parsing text
      if (responseData.candidates && responseData.candidates[0] && responseData.candidates[0].content &&
          responseData.candidates[0].content.parts && responseData.candidates[0].content.parts[0] &&
          responseData.candidates[0].content.parts[0].text) {

        const text = responseData.candidates[0].content.parts[0].text;
        console.log('Using text response. Text content:', text);
        const jsonMatch = text.match(/\{[\s\S]*\}/); // Basic regex to find a JSON object
        if (jsonMatch) {
            const jsonStr = jsonMatch[0];
            try {
                const parsedJson = JSON.parse(jsonStr);
                if (parsedJson.groups) {
                    groupMapping = parsedJson.groups;
                    console.log('Extracted "groups" property from text JSON:', Object.keys(groupMapping).length);
                } else if (Object.keys(parsedJson).length > 0 && Object.keys(parsedJson).every(key => /^\d+$/.test(key) && Array.isArray(parsedJson[key]))) {
                    // If the parsed JSON is directly the groups object like {"1": [...], "2": [...]}
                    // This case might be less likely if the prompt strictly asks for {"groups": ...}
                    groupMapping = parsedJson;
                    console.log('Extracted groups directly from text JSON:', Object.keys(groupMapping).length);
                } else {
                    console.warn('Parsed JSON from text does not have "groups" property or match direct group structure. Parsed:', parsedJson);
                }
            } catch (e) {
                console.error('Error parsing JSON from text response:', e, 'JSON string that failed to parse:', jsonStr);
            }
        } else {
            console.warn('No JSON object-like structure found in text response. Text was:', text);
        }
      } else {
        console.warn('Response structure did not contain expected text part for parsing.', responseData);
      }

      if (!groupMapping || Object.keys(groupMapping).length === 0) {
        console.warn('Could not parse subtitle grouping result from API text or result is empty, using fallback grouping.');
        groupMapping = createFallbackGroupMapping(subtitles, maxGroupSize);
        console.log('Created fallback grouping with', Object.keys(groupMapping).length, 'groups:', groupMapping);
      }
    } catch (error) {
      console.error('Error processing API response for subtitle grouping:', error);
    }

    groupMapping = enforceSafeGroupMapping(subtitles, groupMapping, maxGroupSize);
    const groupedSubtitles = createGroupedSubtitles(subtitles, groupMapping);
    const groupedOriginalIds = new Set(groupedSubtitles.flatMap(group => group.original_ids || []).map(String));
    const success = Object.keys(groupMapping).length > 0 &&
      groupedSubtitles.length > 0 &&
      groupedOriginalIds.size === subtitles.length;

    if (!success && subtitles.length > 0) {
        console.warn("Grouping failed or resulted in no groups. Original subtitles count:", subtitles.length);
    }

    return {
      success: success,
      groupedSubtitles: success ? groupedSubtitles : subtitles,
      groupMapping: success ? groupMapping : {},
      error: !success ? (groupMapping && Object.keys(groupMapping).length === 0 ? 'Failed to generate/parse group mapping from API.' : 'Grouping produced no valid subtitle groups.') : null
    };

  } catch (error) {
    console.error('Critical error in groupSubtitlesForNarration:', error.message);
    return {
      success: false,
      error: error.message,
      groupedSubtitles: subtitles,
      groupMapping: {}
    };
  }
};

// createGroupedSubtitles function remains the same
const createGroupedSubtitles = (originalSubtitles, groupMapping) => {
  if (!groupMapping || Object.keys(groupMapping).length === 0) {
    console.warn('createGroupedSubtitles called with empty/null groupMapping. Returning empty array.');
    return [];
  }
  console.log('Creating grouped subtitles from mapping with', Object.keys(groupMapping).length, 'groups');

  const subtitleMap = originalSubtitles.reduce((map, sub, index) => {
    const id = getSubtitleId(sub, index);
    map.set(String(id), {
        ...sub,
        start: getSubtitleStart(sub),
        end: getSubtitleEnd(sub),
        original_id_for_lookup: id
    });
    return map;
  }, new Map());
  const sourceIndexById = new Map(originalSubtitles.map((sub, index) => [String(getSubtitleId(sub, index)), index]));

  const groupedSubtitlesResult = Object.entries(groupMapping)
    .map(([groupIdStr, subtitleIdsInGroup]) => {
      const groupId = parseInt(groupIdStr, 10);
      if (isNaN(groupId)) {
          console.warn(`Invalid group ID string: ${groupIdStr}, skipping.`);
          return null;
      }
      if (!Array.isArray(subtitleIdsInGroup) || subtitleIdsInGroup.length === 0) {
        console.warn(`Group ${groupIdStr} has invalid/empty subtitle IDs, skipping.`);
        return null;
      }
      const normalizedIds = subtitleIdsInGroup.map(id => String(id));

      const groupSubtitles = normalizedIds
        .map(id => subtitleMap.get(id))
        .filter(Boolean);

      if (groupSubtitles.length === 0) {
        console.warn(`Group ${groupIdStr} (mapped IDs: ${normalizedIds.join(',')}) resulted in no valid subtitles after lookup, skipping.`);
        return null;
      }
      groupSubtitles.sort((a, b) => {
        return sourceIndexById.get(String(a.original_id_for_lookup)) - sourceIndexById.get(String(b.original_id_for_lookup));
      });
      if (groupSubtitles.some(sub => !Number.isFinite(sub.start) || !Number.isFinite(sub.end))) {
        console.warn(`Group ${groupIdStr} has subtitles without usable timestamps.`);
        return null;
      }
      const startTime = Math.min(...groupSubtitles.map(sub => sub.start));
      const endTime = Math.max(...groupSubtitles.map(sub => sub.end));
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
          console.warn(`Group ${groupIdStr} has NaN start/end times. Subtitles:`, groupSubtitles.map(s => ({id: s.original_id_for_lookup, start: s.start, end: s.end})));
          return null;
      }
      const combinedText = groupSubtitles
        .map(sub => (sub.text || "").trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        subtitle_id: groupId, id: groupId, start: startTime, end: endTime, text: combinedText,
        original_ids: groupSubtitles.map(sub => sub.original_id_for_lookup)
      };
    })
    .filter(Boolean)
    .sort((a,b) => a.id - b.id);
  console.log('Created', groupedSubtitlesResult.length, 'grouped subtitles');
  return groupedSubtitlesResult;
};
