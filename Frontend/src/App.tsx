/**
 * BCI Data Collection - Main Application
 * Orchestrates the screen flow for data collection sessions.
 */

import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { toast } from 'sonner';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { useSocketIO } from './hooks/useSocketIO';
import { useWordSequence } from './hooks/useColorSequence';
import { IntakeForm } from './components/IntakeForm';
import { ReadyScreen } from './components/ReadyScreen';
import { Countdown } from './components/Countdown';
import { WordPresentation } from './components/ColorPresentation';
import { SummaryScreen } from './components/SummaryScreen';
import { ModelDashboard } from './components/ModelDashboard';
import type { ParticipantInfo, SessionSummary } from './types/session';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function BCIApp() {
  const {
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
  } = useSession();

  const [localSummary, setLocalSummary] = useState<SessionSummary | null>(null);

  // Socket.IO handlers
  const handleSessionCreated = useCallback(
    (data: { session_id: string; config: any }) => {
      sessionCreated(data.session_id, {
        session_id: data.session_id,
        participant: state.participant!,
        words_per_trial: data.config.words_per_trial,
        word_duration_ms: data.config.word_duration_ms,
        rest_duration_ms: data.config.rest_duration_ms,
      });
      setScreen('ready');
    },
    [sessionCreated, setScreen, state.participant]
  );

  const handleSessionComplete = useCallback(
    (data: SessionSummary) => {
      setSummary(data);
      setLocalSummary(data);
      setScreen('summary');
    },
    [setSummary, setScreen]
  );

  const handleSocketError = useCallback(
    (error: string) => {
      setError(error);
      toast.error(`Connection error: ${error}`);
    },
    [setError]
  );

  const {
    isConnected,
    eegStatus,
    startSession,
    emitWordStart,
    emitWordEnd,
    emitRestStart,
    emitRestEnd,
    endSession,
    connectEEG,
  } = useSocketIO({
    onSessionCreated: handleSessionCreated,
    onSessionComplete: handleSessionComplete,
    onError: handleSocketError,
  });

  // Update socket connection status
  useEffect(() => {
    setSocketConnected(isConnected);
  }, [isConnected, setSocketConnected]);

  // Word sequence handlers
  const handleWordStart = useCallback(
    (wordName: string, wordId: number, trial: number) => {
      setTrial(trial);
      setWordIndex(wordId);
      setResting(false);
      emitWordStart(wordName, wordId, trial);
    },
    [setTrial, setWordIndex, setResting, emitWordStart]
  );

  const handleWordEnd = useCallback(
    (wordName: string, wordId: number, trial: number) => {
      emitWordEnd(wordName, wordId, trial);
    },
    [emitWordEnd]
  );

  const handleRestStart = useCallback(
    (trial: number) => {
      setResting(true);
      emitRestStart(trial);
    },
    [setResting, emitRestStart]
  );

  const handleRestEnd = useCallback(
    (trial: number) => {
      emitRestEnd(trial);
    },
    [emitRestEnd]
  );

  const handleSequenceComplete = useCallback(() => {
    endSession();
  }, [endSession]);

  const {
    currentTrial,
    currentWord,
    isResting,
    start: startWordSequence,
    stop: stopWordSequence,
    reset: resetWordSequence,
  } = useWordSequence({
    totalTrials: state.participant?.total_trials || 1,
    onWordStart: handleWordStart,
    onWordEnd: handleWordEnd,
    onRestStart: handleRestStart,
    onRestEnd: handleRestEnd,
    onComplete: handleSequenceComplete,
  });

  const handleAbortSession = useCallback(async () => {
    stopWordSequence();
    // Use REST DELETE directly — do NOT emit session_end via socket, which would
    // trigger session_complete and navigate to the summary screen.
    if (state.sessionId) {
      try {
        await fetch(`${API_URL}/api/session/${state.sessionId}`, { method: 'DELETE' });
      } catch (error) {
        console.error('Failed to delete aborted session:', error);
      }
    }
    reset();
    resetWordSequence();
    setLocalSummary(null);
  }, [stopWordSequence, state.sessionId, reset, resetWordSequence]);

  // Screen handlers
  const handleIntakeSubmit = useCallback(
    (participant: ParticipantInfo) => {
      setParticipant(participant);
      startSession(participant);
    },
    [setParticipant, startSession]
  );

  const handleReadyStart = useCallback(() => {
    setScreen('countdown');
  }, [setScreen]);

  const handleCountdownComplete = useCallback(() => {
    setScreen('running');
    startWordSequence();
  }, [setScreen, startWordSequence]);

  const handleSaveData = useCallback(async () => {
    if (!state.sessionId) return;

    try {
      const response = await fetch(`${API_URL}/api/session/${state.sessionId}/save`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to save session');

      toast.success('Data saved successfully on server!');
    } catch (error) {
      toast.error('Failed to save data');
      console.error(error);
    }
  }, [state.sessionId]);

  const handleDeleteData = useCallback(async () => {
    if (!state.sessionId) return;

    try {
      const response = await fetch(`${API_URL}/api/session/${state.sessionId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete session');

      toast.success('Data deleted successfully');
      reset();
      resetWordSequence();
      setLocalSummary(null);
    } catch (error) {
      toast.error('Failed to delete data');
      console.error(error);
    }
  }, [state.sessionId, reset, resetWordSequence]);

  const handleNewSession = useCallback(() => {
    reset();
    resetWordSequence();
    setLocalSummary(null);
  }, [reset, resetWordSequence]);

  const handleGoToModel = useCallback(() => {
    setScreen('model');
  }, [setScreen]);

  const handleBackFromModel = useCallback(() => {
    reset();
    resetWordSequence();
    setLocalSummary(null);
    setScreen('intake');
  }, [reset, resetWordSequence, setScreen]);

  // Warn before closing during session
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.screenState === 'running' || state.screenState === 'countdown') {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.screenState]);

  // Render current screen
  const renderScreen = () => {
    switch (state.screenState) {
      case 'intake':
        return (
          <>
            <IntakeForm onSubmit={handleIntakeSubmit} />
            <button
              onClick={handleGoToModel}
              className="fixed bottom-4 right-4 z-50 text-xs px-3 py-1.5 rounded-full
                         bg-gray-800/80 text-gray-400 border border-gray-700
                         hover:bg-gray-700 hover:text-white transition-colors"
            >
              Model Dashboard
            </button>
          </>
        );

      case 'ready':
        return (
          <ReadyScreen
            onStart={handleReadyStart}
            participantName={state.participant?.name || 'Participant'}
            totalTrials={state.participant?.total_trials || 1}
            eegStatus={eegStatus}
            onConnectEEG={connectEEG}
          />
        );

      case 'countdown':
        return <Countdown onComplete={handleCountdownComplete} />;

      case 'running':
        return (
          <WordPresentation
            currentWord={currentWord}
            isResting={isResting}
            currentTrial={currentTrial}
            totalTrials={state.participant?.total_trials || 1}
            onStop={handleAbortSession}
          />
        );

      case 'summary':
        if (!localSummary) return null;
        return (
          <SummaryScreen
            summary={localSummary}
            onSave={handleSaveData}
            onDelete={handleDeleteData}
            onNewSession={handleNewSession}
            onGoToModel={handleGoToModel}
          />
        );

      case 'model':
        return (
          <ModelDashboard
            onBack={handleBackFromModel}
            preSelectedSessionId={state.sessionId}
          />
        );

      default:
        return <IntakeForm onSubmit={handleIntakeSubmit} />;
    }
  };

  return (
    <>
      {renderScreen()}
      <Toaster position="bottom-right" richColors />
    </>
  );
}

function App() {
  return (
    <SessionProvider>
      <BCIApp />
    </SessionProvider>
  );
}

export default App;
