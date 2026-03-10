import fs from 'node:fs';
import path from 'node:path';
import { RedteamTestCase } from './types';

export function loadDatasets(datasetFiles: string[]): RedteamTestCase[] {
  const cases: RedteamTestCase[] = [];

  for (const file of datasetFiles) {
    const fullPath = path.resolve(file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Dataset file not found: ${fullPath}`);
    }
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = JSON.parse(raw);
    const list: RedteamTestCase[] = Array.isArray(parsed) ? parsed : parsed.tests;
    if (!Array.isArray(list)) {
      throw new Error(`Dataset file has invalid format: ${fullPath}`);
    }
    for (const testCase of list) {
      validateCase(testCase, fullPath);
      cases.push(testCase);
    }
  }

  return cases;
}

function validateCase(testCase: RedteamTestCase, source: string) {
  if (!testCase.id || typeof testCase.id !== 'string') {
    throw new Error(`Invalid test case id in ${source}`);
  }
  if (!testCase.category || typeof testCase.category !== 'string') {
    throw new Error(`Invalid category for test case ${testCase.id} in ${source}`);
  }
  if (!Array.isArray(testCase.turns) || testCase.turns.length === 0) {
    throw new Error(`Test case ${testCase.id} must include at least one turn in ${source}`);
  }
  for (let i = 0; i < testCase.turns.length; i += 1) {
    const turn = testCase.turns[i];
    if (!turn || typeof turn.input !== 'string' || !turn.input.trim()) {
      throw new Error(`Test case ${testCase.id} has invalid input at turn ${i + 1} in ${source}`);
    }
  }
}
