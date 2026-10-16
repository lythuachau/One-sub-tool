const { PORTS } = require('../config');

const cancelledGenerations = new Map();
const retentionMs = 60 * 60 * 1000;
const validGenerationId = value => typeof value === 'string' && /^generation_[A-Za-z0-9_-]{1,112}$/.test(value);

const isGenerationCancelled = generationId => {
  const cancelledAt = cancelledGenerations.get(generationId);
  return cancelledAt !== undefined && Date.now() - cancelledAt < retentionMs;
};

const cancelGeneration = async (req, res) => {
  const generationId = req.body?.generation_id;
  if (!validGenerationId(generationId)) {
    return res.status(400).json({ error: 'A valid OmniVoice generation_id is required' });
  }

  const now = Date.now();
  for (const [id, timestamp] of cancelledGenerations) {
    if (now - timestamp >= retentionMs) cancelledGenerations.delete(id);
  }
  cancelledGenerations.set(generationId, now);
  console.log(`[OmniVoice] Cancel requested generation=${generationId}`);

  try {
    const response = await fetch(`http://127.0.0.1:${PORTS.OMNIVOICE || PORTS.CHATTERBOX}/tts/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation_id: generationId }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`OmniVoice cancellation returned HTTP ${response.status}`);
    const result = await response.json();
    if (!result.cancelled || result.generation_id !== generationId) {
      throw new Error('OmniVoice did not acknowledge cancellation');
    }
    return res.json({ cancelled: true, generation_id: generationId });
  } catch (error) {
    return res.status(502).json({
      cancelled: true,
      backend_confirmed: false,
      generation_id: generationId,
      error: `OmniVoice cancellation was not confirmed: ${error.message}`
    });
  }
};

module.exports = { cancelGeneration, isGenerationCancelled };
