/**
 * BCI Data Collection - Color Constants
 * Color definitions and timing configurations matching backend.
 */

export interface ColorDefinition {
  id: number;
  name: string;
  hex: string;
  textColor: string;
}

// 7 Training Colors shown in order
export const COLORS: ColorDefinition[] = [
  { id: 0, name: 'RED', hex: '#FF0000', textColor: '#FFFFFF' },
  { id: 1, name: 'BLUE', hex: '#0000FF', textColor: '#FFFFFF' },
  { id: 2, name: 'GREEN', hex: '#00FF00', textColor: '#000000' },
  { id: 3, name: 'PINK', hex: '#FF69B4', textColor: '#000000' },
  { id: 4, name: 'YELLOW', hex: '#FFFF00', textColor: '#000000' },
  { id: 5, name: 'ORANGE', hex: '#FFA500', textColor: '#000000' },
  { id: 6, name: 'BLACK', hex: '#000000', textColor: '#FFFFFF' },
];

// Rest screen color (not a training color)
export const REST_COLOR = '#FFFFFF';

// Timing constants (in milliseconds)
export const COLOR_DURATION_MS = 5000; // 5 seconds per color
export const REST_DURATION_MS = 2000; // 2 seconds rest between colors
export const COUNTDOWN_DURATION_S = 3; // 3 second countdown

// Derived constants
export const COLORS_PER_TRIAL = COLORS.length; // 7 colors
export const TRIAL_DURATION_MS =
  (COLOR_DURATION_MS + REST_DURATION_MS) * COLORS_PER_TRIAL; // 49 seconds

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
    label: '5 trials (~4 min)',
  },
  {
    trials: 10,
    durationMin: Math.round((10 * TRIAL_DURATION_MS) / 60000),
    label: '10 trials (~8 min)',
  },
  {
    trials: 25,
    durationMin: Math.round((25 * TRIAL_DURATION_MS) / 60000),
    label: '25 trials (~20 min)',
  },
  {
    trials: 50,
    durationMin: Math.round((50 * TRIAL_DURATION_MS) / 60000),
    label: '50 trials (~41 min)',
  },
  {
    trials: 100,
    durationMin: Math.round((100 * TRIAL_DURATION_MS) / 60000),
    label: '100 trials (~82 min)',
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
