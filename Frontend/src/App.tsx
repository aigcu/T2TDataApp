/**
 * BCI Data Collection - Main Application
 * Orchestrates the screen flow for data collection sessions.
 */

import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { toast } from 'sonner';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { useSocketIO } from './hooks/useSocketIO';
import { useColorSequence } from './hooks/useColorSequence';
import { IntakeForm } from './components/IntakeForm';
import { ReadyScreen } from './components/ReadyScreen';
import { Countdown } from './components/Countdown';
import { ColorPresentation } from './components/ColorPresentation';
import { SummaryScreen } from './components/SummaryScreen';
import type { ParticipantInfo, SessionSummary } from './types/session';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function BCIApp() {
  const {
    state,
    setParticipant,
    setScreen,
    sessionCreated,
    setTrial,
    setColorIndex,
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
        colors_per_trial: data.config.colors_per_trial,
        color_duration_ms: data.config.color_duration_ms,
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
    emitColorStart,
    emitColorEnd,
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

  // Color sequence handlers
  const handleColorStart = useCallback(
    (colorName: string, colorId: number, trial: number) => {
      setTrial(trial);
      setColorIndex(colorId);
      setResting(false);
      emitColorStart(colorName, colorId, trial);
    },
    [setTrial, setColorIndex, setResting, emitColorStart]
  );

  const handleColorEnd = useCallback(
    (colorName: string, colorId: number, trial: number) => {
      emitColorEnd(colorName, colorId, trial);
    },
    [emitColorEnd]
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
    currentColor,
    isResting,
    start: startColorSequence,
    reset: resetColorSequence,
  } = useColorSequence({
    totalTrials: state.participant?.total_trials || 1,
    onColorStart: handleColorStart,
    onColorEnd: handleColorEnd,
    onRestStart: handleRestStart,
    onRestEnd: handleRestEnd,
    onComplete: handleSequenceComplete,
  });

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
    startColorSequence();
  }, [setScreen, startColorSequence]);

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
      resetColorSequence();
      setLocalSummary(null);
    } catch (error) {
      toast.error('Failed to delete data');
      console.error(error);
    }
  }, [state.sessionId, reset, resetColorSequence]);

  const handleNewSession = useCallback(() => {
    reset();
    resetColorSequence();
    setLocalSummary(null);
  }, [reset, resetColorSequence]);

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
        return <IntakeForm onSubmit={handleIntakeSubmit} />;

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
          <ColorPresentation
            currentColor={currentColor}
            isResting={isResting}
            currentTrial={currentTrial}
            totalTrials={state.participant?.total_trials || 1}
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
