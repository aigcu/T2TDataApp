/**
 * BCI Data Collection - Color Sequence Hook
 * Manages the color presentation sequence with accurate timing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COLOR_DURATION_MS,
  COLORS,
  COLORS_PER_TRIAL,
  REST_DURATION_MS,
} from '../constants/colors';

interface UseColorSequenceOptions {
  totalTrials: number;
  onColorStart?: (colorName: string, colorId: number, trial: number) => void;
  onColorEnd?: (colorName: string, colorId: number, trial: number) => void;
  onRestStart?: (trial: number) => void;
  onRestEnd?: (trial: number) => void;
  onComplete?: () => void;
}

export function useColorSequence(options: UseColorSequenceOptions) {
  const { totalTrials, onColorStart, onColorEnd, onRestStart, onRestEnd, onComplete } =
    options;

  const [isRunning, setIsRunning] = useState(false);
  const [currentTrial, setCurrentTrial] = useState(1);
  const [currentColorIndex, setCurrentColorIndex] = useState(0);
  const [isResting, setIsResting] = useState(false);

  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const isRunningRef = useRef(false);

  // Refs to track current state for timer callbacks (avoids stale closures)
  const currentTrialRef = useRef(1);
  const currentColorIndexRef = useRef(0);
  const isRestingRef = useRef(false);

  // Clear any running timer
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      cancelAnimationFrame(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Run timer with requestAnimationFrame for accuracy
  const runTimer = useCallback(
    (duration: number, onComplete: () => void) => {
      startTimeRef.current = performance.now();

      const tick = (timestamp: number) => {
        if (!isRunningRef.current) return;

        const elapsed = timestamp - startTimeRef.current;
        if (elapsed >= duration) {
          onComplete();
        } else {
          timerRef.current = requestAnimationFrame(tick);
        }
      };

      timerRef.current = requestAnimationFrame(tick);
    },
    []
  );

  // Advance to next state in sequence
  const advanceSequence = useCallback(() => {
    if (!isRunningRef.current) return;

    // Read from refs to avoid stale closure issues
    const trial = currentTrialRef.current;
    const colorIdx = currentColorIndexRef.current;
    const resting = isRestingRef.current;

    if (resting) {
      // End rest period
      onRestEnd?.(trial);

      // Check if we need to advance to next color or trial
      const nextColorIdx = colorIdx + 1;

      if (nextColorIdx >= COLORS_PER_TRIAL) {
        // End of trial
        const nextTrial = trial + 1;

        if (nextTrial > totalTrials) {
          // Session complete
          setIsRunning(false);
          isRunningRef.current = false;
          onComplete?.();
          return;
        }

        // Start next trial, first color - update both state and refs
        currentTrialRef.current = nextTrial;
        currentColorIndexRef.current = 0;
        isRestingRef.current = false;
        setCurrentTrial(nextTrial);
        setCurrentColorIndex(0);
        setIsResting(false);

        const color = COLORS[0];
        onColorStart?.(color.name, color.id, nextTrial);
        runTimer(COLOR_DURATION_MS, advanceSequence);
      } else {
        // Next color in same trial - update both state and refs
        currentColorIndexRef.current = nextColorIdx;
        isRestingRef.current = false;
        setCurrentColorIndex(nextColorIdx);
        setIsResting(false);

        const color = COLORS[nextColorIdx];
        onColorStart?.(color.name, color.id, trial);
        runTimer(COLOR_DURATION_MS, advanceSequence);
      }
    } else {
      // End color, start rest
      const color = COLORS[colorIdx];
      onColorEnd?.(color.name, color.id, trial);

      // Update both state and ref
      isRestingRef.current = true;
      setIsResting(true);
      onRestStart?.(trial);
      runTimer(REST_DURATION_MS, advanceSequence);
    }
  }, [
    totalTrials,
    onColorStart,
    onColorEnd,
    onRestStart,
    onRestEnd,
    onComplete,
    runTimer,
  ]);

  // Start the sequence
  const start = useCallback(() => {
    if (isRunningRef.current) return;

    // Initialize both state and refs
    setIsRunning(true);
    isRunningRef.current = true;
    currentTrialRef.current = 1;
    currentColorIndexRef.current = 0;
    isRestingRef.current = false;
    setCurrentTrial(1);
    setCurrentColorIndex(0);
    setIsResting(false);

    // Start with first color
    const color = COLORS[0];
    onColorStart?.(color.name, color.id, 1);
    runTimer(COLOR_DURATION_MS, advanceSequence);
  }, [onColorStart, runTimer, advanceSequence]);

  // Stop the sequence
  const stop = useCallback(() => {
    setIsRunning(false);
    isRunningRef.current = false;
    clearTimer();
  }, [clearTimer]);

  // Reset state
  const reset = useCallback(() => {
    stop();
    // Reset both state and refs
    currentTrialRef.current = 1;
    currentColorIndexRef.current = 0;
    isRestingRef.current = false;
    setCurrentTrial(1);
    setCurrentColorIndex(0);
    setIsResting(false);
  }, [stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
      isRunningRef.current = false;
    };
  }, [clearTimer]);

  // Get current color
  const currentColor = isResting ? null : COLORS[currentColorIndex];

  return {
    isRunning,
    currentTrial,
    currentColorIndex,
    currentColor,
    isResting,
    start,
    stop,
    reset,
  };
}
