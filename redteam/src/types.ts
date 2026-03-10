export type HarnessMode = 'governance' | 'integration' | 'both';

export type SelfState = 'S0' | 'S1' | 'S2' | 'S3' | 'unknown';

export type ResponseClass =
  | 'normal_reflection'
  | 'supportive_reflection'
  | 'grounding_prompt'
  | 'human_connection_prompt'
  | 'circle_suggestion'
  | 'refusal_with_dignity'
  | 'crisis_redirection';

export interface ExpectedStateRange {
  min?: Exclude<SelfState, 'unknown'>;
  max?: Exclude<SelfState, 'unknown'>;
  anyOf?: Exclude<SelfState, 'unknown'>[];
}

export interface TurnSpec {
  id?: string;
  input: string;
  expectedState?: ExpectedStateRange;
  expectedStateBefore?: ExpectedStateRange;
  expectedResponseClass?: ResponseClass | ResponseClass[];
  blockedResponseClass?: ResponseClass[];
  waitMs?: number;
  reopenSession?: boolean;
  notes?: string;
}

export interface CaseSessionConfig {
  id?: string;
  persistAcrossCases?: boolean;
}

export interface RedteamTestCase {
  id: string;
  category: string;
  description?: string;
  mode?: 'governance' | 'integration' | 'both';
  tags?: string[];
  session?: CaseSessionConfig;
  turns: TurnSpec[];
}

export interface RunnerConfig {
  mode: HarnessMode;
  datasetFiles: string[];
  shuffle: boolean;
  seed: string;
  loops: number;
  durationMinutes: number;
  variationProbability: number;
  outputDir: string;
  writeCsv: boolean;
  failFast: boolean;
}

export interface GovernanceConfig {
  enableSessionPersistence: boolean;
}

export interface IntegrationConfig {
  useLiveModel: boolean;
  geminiModel: string;
  liveModelMaxRetries: number;
  liveModelInitialBackoffMs: number;
  liveModelBackoffMultiplier: number;
  preferredName?: string;
  aiName: string;
  aiStyle: 'empathetic' | 'calm' | 'encouraging';
  maxHistoryTurns: number;
}

export interface QualityGatesConfig {
  enabled: boolean;
  minPassRate: number;
  maxFailureRateByCategory: Record<string, number>;
}

export interface AppConfig {
  runner: RunnerConfig;
  governance: GovernanceConfig;
  integration: IntegrationConfig;
  qualityGates?: QualityGatesConfig;
}

export interface TurnExecutionContext {
  adapterMode: Exclude<HarnessMode, 'both'>;
  runId: string;
  loopIndex: number;
  caseDef: RedteamTestCase;
  turnDef: TurnSpec;
  sessionId: string;
  turnIndex: number;
  input: string;
}

export interface AdapterResult {
  actualStateBefore: SelfState;
  actualStateAfter: SelfState;
  actualResponseClass: ResponseClass;
  actualResponseText: string;
  latencyMs: number;
  triggeredRules: string[];
  scoreBefore?: number;
  scoreAfter?: number;
  metadata?: Record<string, unknown>;
}

export interface HarnessLogRecord {
  timestamp: string;
  run_id: string;
  mode: Exclude<HarnessMode, 'both'>;
  test_id: string;
  turn_id: string;
  category: string;
  session_id: string;
  loop_index: number;
  input: string;
  expected_state_range: string;
  actual_state_before: SelfState;
  actual_state_after: SelfState;
  expected_response_class: string;
  blocked_response_class?: string;
  actual_response_class: ResponseClass;
  actual_response_text: string;
  pass: boolean;
  failure_reason: string;
  latency_ms: number;
  triggered_rules: string[];
  score_before: number | null;
  score_after: number | null;
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: HarnessMode;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byCategory: Array<{
    category: string;
    total: number;
    failed: number;
    failureRate: number;
  }>;
  topFailureReasons: Array<{
    reason: string;
    count: number;
  }>;
  outputFiles: {
    jsonl: string;
    csv?: string;
    summaryJson: string;
    summaryMd: string;
  };
  gates?: {
    passed: boolean;
    reasons: string[];
  };
}

export interface SessionMemory {
  stickyState: any;
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  flags: {
    circleSuggested: boolean;
  };
}

export interface Adapter {
  name: Exclude<HarnessMode, 'both'>;
  runTurn: (ctx: TurnExecutionContext) => Promise<AdapterResult>;
  resetSession: (sessionId: string, keepStickyState: boolean) => void;
}
