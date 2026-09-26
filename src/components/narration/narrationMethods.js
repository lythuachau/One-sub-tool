export const NARRATION_METHODS = Object.freeze({
  VIENEU: 'vieneu',
  OMNIVOICE: 'omnivoice',
  CAPCUT: 'capcut',
  VIBI: 'vibi'
});

const LEGACY_METHOD_ALIASES = Object.freeze({
  f5tts: NARRATION_METHODS.VIENEU,
  chatterbox: NARRATION_METHODS.OMNIVOICE
});

export const normalizeNarrationMethod = (method) => {
  if (LEGACY_METHOD_ALIASES[method]) return LEGACY_METHOD_ALIASES[method];
  if (Object.values(NARRATION_METHODS).includes(method)) return method;
  return NARRATION_METHODS.VIENEU;
};
