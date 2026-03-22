/**
 * BCI Data Collection - Word Constants
 * Word definitions and timing configurations matching backend.
 */

export interface WordDefinition {
  id: number;
  name: string;
}

// 10 Training Words shown in order
export const WORDS: WordDefinition[] = [
  { id: 0, name: 'YES' },
  { id: 1, name: 'NO' },
  { id: 2, name: 'HELP' },
  { id: 3, name: 'STOP' },
  { id: 4, name: 'GO' },
  { id: 5, name: 'WATER' },
  { id: 6, name: 'FOOD' },
  { id: 7, name: 'PAIN' },
  { id: 8, name: 'MORE' },
  { id: 9, name: 'NEED' },
];

// Timing constants (in milliseconds)
export const WORD_DURATION_MS = 5000;  // 5 seconds per word
export const REST_DURATION_MS = 2000;  // 2 seconds rest between words
export const COUNTDOWN_DURATION_S = 3; // 3 second countdown

// Derived constants
export const WORDS_PER_TRIAL = WORDS.length; // 10 words
export const TRIAL_DURATION_MS =
  (WORD_DURATION_MS + REST_DURATION_MS) * WORDS_PER_TRIAL; // 70 seconds

// Trial count options with calculated durations
export interface TrialOption {
  trials: number;
  durationMin: number;
  label: string;
}

export const TRIAL_OPTIONS: TrialOption[] = [
  {
    trials: 5,
    durationMin: Math.round((5 * TRIAL_DURATION_MS) / 60000),
    label: '5 trials (~6 min)',
  },
  {
    trials: 10,
    durationMin: Math.round((10 * TRIAL_DURATION_MS) / 60000),
    label: '10 trials (~12 min)',
  },
  {
    trials: 25,
    durationMin: Math.round((25 * TRIAL_DURATION_MS) / 60000),
    label: '25 trials (~29 min)',
  },
  {
    trials: 50,
    durationMin: Math.round((50 * TRIAL_DURATION_MS) / 60000),
    label: '50 trials (~58 min)',
  },
  {
    trials: 100,
    durationMin: Math.round((100 * TRIAL_DURATION_MS) / 60000),
    label: '100 trials (~117 min)',
  },
];

// Form options
export const SEX_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];

export const RACE_OPTIONS = [
  'White',
  'Black/African American',
  'Asian',
  'Hispanic/Latino',
  'Native American',
  'Pacific Islander',
  'Two or more',
  'Other',
  'Prefer not to say',
];
