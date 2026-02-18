/**
 * BCI Data Collection - Type Definitions
 * TypeScript interfaces for sessions, events, and state.
 */

export type ScreenState =
  | 'intake'
  | 'ready'
  | 'countdown'
  | 'running'
  | 'summary';

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
  colors_per_trial: number;
  color_duration_ms: number;
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
  colors_presented: number;
  rest_periods: number;
  start_time: string;
  end_time: string;
  total_duration_ms: number;
}

export interface ColorEvent {
  event_type: string;
  color?: string;
  color_id?: number;
  trial: number;
  timestamp: string;
  relative_time_ms: number;
}

// Socket.IO event payloads
export interface SocketColorEvent {
  color: string;
  color_id: number;
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
    colors_per_trial: number;
    color_duration_ms: number;
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
  color?: string;
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
  colors_presented: number;
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
  currentColorIndex: number;
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
  | { type: 'SET_COLOR_INDEX'; payload: number }
  | { type: 'SET_RESTING'; payload: boolean }
  | { type: 'SET_SUMMARY'; payload: SessionSummary }
  | { type: 'SET_SOCKET_CONNECTED'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'RESET' };
