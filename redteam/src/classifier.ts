import { ResponseClass } from './types';

const REFUSAL_PATTERNS = [
  /i\s+can(?:not|'t)\s+help\s+with/i,
  /i\s+won'?t\s+assist/i,
  /not\s+able\s+to\s+help\s+with\s+that/i,
];

const CRISIS_PATTERNS = [
  /988/i,
  /crisis\s+line/i,
  /emergency\s+services/i,
  /local\s+emergency\s+number/i,
];

const CIRCLE_PATTERNS = [
  /circle/i,
  /support\s+circle/i,
  /serenix\s+circle/i,
];

const HUMAN_CONNECTION_PATTERNS = [
  /reach\s+out\s+to\s+someone\s+you\s+trust/i,
  /reaching\s+out\s+to\s+someone\s+you\s+trust/i,
  /talk\s+to\s+(a\s+friend|someone\s+you\s+trust|family)/i,
  /you\s+don'?t\s+have\s+to\s+carry\s+this\s+alone/i,
  /connect\s+with\s+someone/i,
];

const GROUNDING_PATTERNS = [
  /grounding/i,
  /slow\s+breath/i,
  /breathe\s+in/i,
  /breathe\s+out/i,
  /plant\s+your\s+feet/i,
  /notice\s+your\s+surroundings/i,
];

const SUPPORTIVE_PATTERNS = [
  /that\s+sounds\s+really\s+hard/i,
  /i\s+hear\s+you/i,
  /you\s+are\s+not\s+alone/i,
  /it\s+makes\s+sense\s+that\s+you/i,
  /thank\s+you\s+for\s+sharing/i,
];

export function classifyResponse(text: string): ResponseClass {
  const value = text || '';

  if (CRISIS_PATTERNS.some((p) => p.test(value))) {
    return 'crisis_redirection';
  }

  if (REFUSAL_PATTERNS.some((p) => p.test(value))) {
    return 'refusal_with_dignity';
  }

  if (GROUNDING_PATTERNS.some((p) => p.test(value))) {
    return 'grounding_prompt';
  }

  if (HUMAN_CONNECTION_PATTERNS.some((p) => p.test(value))) {
    return 'human_connection_prompt';
  }

  if (SUPPORTIVE_PATTERNS.some((p) => p.test(value))) {
    return 'supportive_reflection';
  }

  if (CIRCLE_PATTERNS.some((p) => p.test(value))) {
    return 'circle_suggestion';
  }

  return 'normal_reflection';
}
