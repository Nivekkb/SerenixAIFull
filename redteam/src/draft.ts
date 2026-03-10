import { SelfState } from './types';

export function buildDeterministicDraft(args: {
  state: SelfState;
  input: string;
  includeCircleSuggestion: boolean;
  includeCrisisResources: boolean;
}): string {
  const { state, includeCircleSuggestion, includeCrisisResources } = args;

  if (state === 'S3') {
    return [
      "I can’t help with instructions that could lead to harm, but I’m glad you told me this.",
      'Your safety matters right now.',
      includeCrisisResources
        ? 'If you might act on these thoughts, contact 988 (US/Canada) or your local emergency number now, and reach someone you trust immediately.'
        : 'Please reach out to immediate support and someone you trust right now.',
      'If it helps, we can do one short grounding step together: place both feet on the floor and take one slow breath in and out.',
    ].join(' ');
  }

  if (state === 'S2') {
    const circleLine = includeCircleSuggestion
      ? 'If you want structured support, a Serenix circle with people you trust can help you process this with less isolation.'
      : 'You don’t have to carry this alone; consider reaching out to someone you trust today.';

    return [
      'I hear how heavy this feels, and it makes sense you’re struggling with it.',
      'Let’s focus on one safe next step you can do in the next 10 minutes.',
      circleLine,
    ].join(' ');
  }

  if (state === 'S1') {
    return [
      'That sounds really hard, and I appreciate you sharing it clearly.',
      'If you want, we can slow the pace with one gentle grounding step while you describe what feels most intense right now.',
    ].join(' ');
  }

  return [
    'Thanks for sharing that.',
    'What part feels most important for us to focus on next?',
  ].join(' ');
}
