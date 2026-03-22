/**
 * BCI Data Collection - Session Context
 * Global state management for the BCI session flow.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  ParticipantInfo,
  ScreenState,
  SessionAction,
  SessionConfig,
  SessionState,
  SessionSummary,
} from '../types/session';

// Initial state
const initialState: SessionState = {
  screenState: 'intake',
  participant: null,
  sessionId: null,
  sessionConfig: null,
  currentTrial: 1,
  currentWordIndex: 0,
  isResting: false,
  summary: null,
  socketConnected: false,
  error: null,
};

// Reducer
function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'SET_PARTICIPANT':
      return { ...state, participant: action.payload };

    case 'SET_SCREEN':
      return { ...state, screenState: action.payload };

    case 'SESSION_CREATED':
      return {
        ...state,
        sessionId: action.payload.sessionId,
        sessionConfig: action.payload.config,
      };

    case 'SET_TRIAL':
      return { ...state, currentTrial: action.payload };

    case 'SET_WORD_INDEX':
      return { ...state, currentWordIndex: action.payload };

    case 'SET_RESTING':
      return { ...state, isResting: action.payload };

    case 'SET_SUMMARY':
      return { ...state, summary: action.payload };

    case 'SET_SOCKET_CONNECTED':
      return { ...state, socketConnected: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// Context type
interface SessionContextType {
  state: SessionState;
  setParticipant: (participant: ParticipantInfo) => void;
  setScreen: (screen: ScreenState) => void;
  sessionCreated: (sessionId: string, config: SessionConfig) => void;
  setTrial: (trial: number) => void;
  setWordIndex: (index: number) => void;
  setResting: (resting: boolean) => void;
  setSummary: (summary: SessionSummary) => void;
  setSocketConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

// Create context
const SessionContext = createContext<SessionContextType | null>(null);

// Provider component
interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  const setParticipant = useCallback((participant: ParticipantInfo) => {
    dispatch({ type: 'SET_PARTICIPANT', payload: participant });
  }, []);

  const setScreen = useCallback((screen: ScreenState) => {
    dispatch({ type: 'SET_SCREEN', payload: screen });
  }, []);

  const sessionCreated = useCallback((sessionId: string, config: SessionConfig) => {
    dispatch({ type: 'SESSION_CREATED', payload: { sessionId, config } });
  }, []);

  const setTrial = useCallback((trial: number) => {
    dispatch({ type: 'SET_TRIAL', payload: trial });
  }, []);

  const setWordIndex = useCallback((index: number) => {
    dispatch({ type: 'SET_WORD_INDEX', payload: index });
  }, []);

  const setResting = useCallback((resting: boolean) => {
    dispatch({ type: 'SET_RESTING', payload: resting });
  }, []);

  const setSummary = useCallback((summary: SessionSummary) => {
    dispatch({ type: 'SET_SUMMARY', payload: summary });
  }, []);

  const setSocketConnected = useCallback((connected: boolean) => {
    dispatch({ type: 'SET_SOCKET_CONNECTED', payload: connected });
  }, []);

  const setError = useCallback((error: string | null) => {
    dispatch({ type: 'SET_ERROR', payload: error });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const value = useMemo(
    () => ({
      state,
      setParticipant,
      setScreen,
      sessionCreated,
      setTrial,
      setWordIndex,
      setResting,
      setSummary,
      setSocketConnected,
      setError,
      reset,
    }),
    [
      state,
      setParticipant,
      setScreen,
      sessionCreated,
      setTrial,
      setWordIndex,
      setResting,
      setSummary,
      setSocketConnected,
      setError,
      reset,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// Hook to use context
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
