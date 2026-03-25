/**
 * BCI Data Collection - Type Definitions
 * TypeScript interfaces for sessions, events, and state.
 */

export type ScreenState =
  | 'intake'
  | 'ready'
  | 'countdown'
  | 'running'
  | 'summary'
  | 'model';

export interface ParticipantInfo {
  name: string;
  age: number;
  sex: string;
  gender: string;
  race: string;
  total_trials: number;
}

export interface SessionConfig {
  session_id: string;
  participant: ParticipantInfo;
  words_per_trial: number;
  word_duration_ms: number;
  rest_duration_ms: number;
  start_time?: string;
  end_time?: string;
}

export interface SessionSummary {
  session_id: string;
  participant_name: string;
  participant_age: number;
  participant_sex: string;
  participant_gender: string;
  participant_race: string;
  total_trials: number;
  words_presented: number;
  rest_periods: number;
  start_time: string;
  end_time: string;
  total_duration_ms: number;
}

export interface WordEvent {
  event_type: string;
  word?: string;
  word_id?: number;
  trial: number;
  timestamp: string;
  relative_time_ms: number;
}

// Socket.IO event payloads
export interface SocketWordEvent {
  word: string;
  word_id: number;
  trial: number;
  timestamp: string;
}

export interface SocketRestEvent {
  trial: number;
  timestamp: string;
}

export interface SocketSessionCreatedEvent {
  session_id: string;
  status: string;
  eeg_streaming: boolean;
  config: {
    words_per_trial: number;
    word_duration_ms: number;
    rest_duration_ms: number;
    total_trials: number;
  };
}

// EEG status types
export type EEGStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'error';

export interface EEGStatusEvent {
  status: EEGStatus;
  hardware_available: boolean;
  port?: string;
  error_message?: string;
  sample_rate?: number;
  num_channels?: number;
}

export interface SocketMarkerLoggedEvent {
  event_type: string;
  word?: string;
  trial: number;
  timestamp: string;
  success: boolean;
}

export interface SocketSessionCompleteEvent {
  session_id: string;
  participant_name: string;
  participant_age: number;
  participant_sex: string;
  participant_gender: string;
  participant_race: string;
  total_trials: number;
  words_presented: number;
  rest_periods: number;
  total_duration_ms: number;
  start_time: string;
  end_time: string;
}

// Session state for context
export interface SessionState {
  screenState: ScreenState;
  participant: ParticipantInfo | null;
  sessionId: string | null;
  sessionConfig: SessionConfig | null;
  currentTrial: number;
  currentWordIndex: number;
  isResting: boolean;
  summary: SessionSummary | null;
  socketConnected: boolean;
  error: string | null;
}

export type SessionAction =
  | { type: 'SET_PARTICIPANT'; payload: ParticipantInfo }
  | { type: 'SET_SCREEN'; payload: ScreenState }
  | { type: 'SESSION_CREATED'; payload: { sessionId: string; config: SessionConfig } }
  | { type: 'SET_TRIAL'; payload: number }
  | { type: 'SET_WORD_INDEX'; payload: number }
  | { type: 'SET_RESTING'; payload: boolean }
  | { type: 'SET_SUMMARY'; payload: SessionSummary }
  | { type: 'SET_SOCKET_CONNECTED'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'RESET' };

// ── Training / Model types ──────────────────────────────────────────────────────

export interface SessionMeta {
  session_id: string;
  filename: string;
  participant_name?: string;
  participant_age?: string;
  total_trials?: string;
  start_time?: string;
  end_time?: string;
  eeg_enabled?: string;
  eeg_sample_count?: number;
}

export interface TrainingConfig {
  lr: number;
  batch_size: number;
  warmup_epochs: number;
  grad_clip: number;
  early_stop_patience: number;
  checkpoint_every_n: number;
  aug_channel_dropout: boolean;
  aug_gaussian_noise: boolean;
  aug_amplitude_scaling: boolean;
  aug_time_shift: boolean;
  aug_freq_band_dropout: boolean;
  use_focal_loss: boolean;
  focal_gamma: number;
  label_smoothing: number;
}

export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  lr: 0.0002,
  batch_size: 8,
  warmup_epochs: 5,
  grad_clip: 1.0,
  early_stop_patience: 25,
  checkpoint_every_n: 5,
  aug_channel_dropout: true,
  aug_gaussian_noise: true,
  aug_amplitude_scaling: true,
  aug_time_shift: true,
  aug_freq_band_dropout: true,
  use_focal_loss: false,
  focal_gamma: 2.0,
  label_smoothing: 0.1,
};

export interface TrainingEpochLog {
  epoch: number;
  loss: number;
  val_loss: number;
  accuracy: number;
  lr: number;
}

export interface ModelCheckpointInfo {
  exists: boolean;
  epoch?: number;
  vocab_size?: number;
  vocab?: string[];
  best_val_loss?: number | null;
  config?: Partial<TrainingConfig>;
}

export interface CheckpointMeta {
  name: string;
  epoch: number;
  val_loss: number | null;
  is_best: boolean;
}

export interface TrainingStatusResponse {
  status: 'idle' | 'training' | 'complete' | 'error';
  current_epoch: number;
  total_epochs: number;
  loss: number;
  val_loss: number;
  best_val_loss: number | null;
  best_epoch: number;
  accuracy: number;
  lr: number;
  error: string | null;
  log: TrainingEpochLog[];
  per_word_accuracy: Record<string, number>;
  checkpoint: ModelCheckpointInfo;
  available_checkpoints: CheckpointMeta[];
}

export interface SessionEvent {
  event: string;
  word: string;
  word_id: string;
  trial: string;
  timestamp: string;
  relative_time_ms: string;
}

export interface WordPrediction {
  trial: string;
  word: string;
  word_id: string;
  relative_time_ms: number;
  predicted: string;
  confidence: number;
  has_eeg: boolean;
}
