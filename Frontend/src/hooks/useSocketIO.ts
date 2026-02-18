/**
 * BCI Data Collection - Socket.IO Hook
 * Manages WebSocket connection for real-time event streaming.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  EEGStatus,
  EEGStatusEvent,
  ParticipantInfo,
  SocketColorEvent,
  SocketMarkerLoggedEvent,
  SocketRestEvent,
  SocketSessionCompleteEvent,
  SocketSessionCreatedEvent,
} from '../types/session';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000';

interface UseSocketIOOptions {
  onSessionCreated?: (data: SocketSessionCreatedEvent) => void;
  onMarkerLogged?: (data: SocketMarkerLoggedEvent) => void;
  onSessionComplete?: (data: SocketSessionCompleteEvent) => void;
  onEEGStatus?: (data: EEGStatusEvent) => void;
  onError?: (error: string) => void;
}

export function useSocketIO(options: UseSocketIOOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [eegStatus, setEegStatus] = useState<EEGStatus>('disconnected');
  const [eegInfo, setEegInfo] = useState<EEGStatusEvent | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Initialize socket connection
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    });

    socket.on('session_created', (data: SocketSessionCreatedEvent) => {
      console.log('Session created:', data);
      setSessionId(data.session_id);
      options.onSessionCreated?.(data);
    });

    socket.on('marker_logged', (data: SocketMarkerLoggedEvent) => {
      console.log('Marker logged:', data);
      options.onMarkerLogged?.(data);
    });

    socket.on('session_complete', (data: SocketSessionCompleteEvent) => {
      console.log('Session complete:', data);
      options.onSessionComplete?.(data);
    });

    socket.on('error', (data: { message: string }) => {
      console.error('Socket error:', data.message);
      options.onError?.(data.message);
    });

    // EEG status updates
    socket.on('eeg_status', (data: EEGStatusEvent) => {
      console.log('EEG status:', data);
      setEegStatus(data.status);
      setEegInfo(data);
      options.onEEGStatus?.(data);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Start a new session
  const startSession = useCallback((participant: ParticipantInfo) => {
    if (!socketRef.current?.connected) {
      console.error('Socket not connected');
      return;
    }
    socketRef.current.emit('session_start', { participant });
  }, []);

  // Emit color start event
  const emitColorStart = useCallback(
    (color: string, colorId: number, trial: number) => {
      if (!socketRef.current?.connected) return;

      const event: SocketColorEvent = {
        color,
        color_id: colorId,
        trial,
        timestamp: new Date().toISOString(),
      };
      socketRef.current.emit('color_start', event);
    },
    []
  );

  // Emit color end event
  const emitColorEnd = useCallback(
    (color: string, colorId: number, trial: number) => {
      if (!socketRef.current?.connected) return;

      const event: SocketColorEvent = {
        color,
        color_id: colorId,
        trial,
        timestamp: new Date().toISOString(),
      };
      socketRef.current.emit('color_end', event);
    },
    []
  );

  // Emit rest start event
  const emitRestStart = useCallback((trial: number) => {
    if (!socketRef.current?.connected) return;

    const event: SocketRestEvent = {
      trial,
      timestamp: new Date().toISOString(),
    };
    socketRef.current.emit('rest_start', event);
  }, []);

  // Emit rest end event
  const emitRestEnd = useCallback((trial: number) => {
    if (!socketRef.current?.connected) return;

    const event: SocketRestEvent = {
      trial,
      timestamp: new Date().toISOString(),
    };
    socketRef.current.emit('rest_end', event);
  }, []);

  // End session
  const endSession = useCallback(() => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('session_end', {});
  }, []);

  // Request current EEG status
  const requestEEGStatus = useCallback(() => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('get_eeg_status', {});
  }, []);

  // Attempt to connect to EEG hardware
  const connectEEG = useCallback(() => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('connect_eeg', {});
  }, []);

  return {
    isConnected,
    sessionId,
    eegStatus,
    eegInfo,
    startSession,
    emitColorStart,
    emitColorEnd,
    emitRestStart,
    emitRestEnd,
    endSession,
    requestEEGStatus,
    connectEEG,
  };
}
