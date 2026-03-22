/**
 * BCI Data Collection - Word Sequence Hook
 * Manages the word presentation sequence with accurate timing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WORD_DURATION_MS,
  WORDS,
  WORDS_PER_TRIAL,
  REST_DURATION_MS,
} from '../constants/colors';

interface UseWordSequenceOptions {
  totalTrials: number;
  onWordStart?: (wordName: string, wordId: number, trial: number) => void;
  onWordEnd?: (wordName: string, wordId: number, trial: number) => void;
  onRestStart?: (trial: number) => void;
  onRestEnd?: (trial: number) => void;
  onComplete?: () => void;
}

export function useWordSequence(options: UseWordSequenceOptions) {
  const { totalTrials, onWordStart, onWordEnd, onRestStart, onRestEnd, onComplete } =
    options;

  const [isRunning, setIsRunning] = useState(false);
  const [currentTrial, setCurrentTrial] = useState(1);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isResting, setIsResting] = useState(false);

  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const isRunningRef = useRef(false);

  // Refs to track current state for timer callbacks (avoids stale closures)
  const currentTrialRef = useRef(1);
  const currentWordIndexRef = useRef(0);
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
    const wordIdx = currentWordIndexRef.current;
    const resting = isRestingRef.current;

    if (resting) {
      // End rest period
      onRestEnd?.(trial);

      // Check if we need to advance to next word or trial
      const nextWordIdx = wordIdx + 1;

      if (nextWordIdx >= WORDS_PER_TRIAL) {
        // End of trial
        const nextTrial = trial + 1;

        if (nextTrial > totalTrials) {
          // Session complete
          setIsRunning(false);
          isRunningRef.current = false;
          onComplete?.();
          return;
        }

        // Start next trial, first word - update both state and refs
        currentTrialRef.current = nextTrial;
        currentWordIndexRef.current = 0;
        isRestingRef.current = false;
        setCurrentTrial(nextTrial);
        setCurrentWordIndex(0);
        setIsResting(false);

        const word = WORDS[0];
        onWordStart?.(word.name, word.id, nextTrial);
        runTimer(WORD_DURATION_MS, advanceSequence);
      } else {
        // Next word in same trial - update both state and refs
        currentWordIndexRef.current = nextWordIdx;
        isRestingRef.current = false;
        setCurrentWordIndex(nextWordIdx);
        setIsResting(false);

        const word = WORDS[nextWordIdx];
        onWordStart?.(word.name, word.id, trial);
        runTimer(WORD_DURATION_MS, advanceSequence);
      }
    } else {
      // End word, start rest
      const word = WORDS[wordIdx];
      onWordEnd?.(word.name, word.id, trial);

      // Update both state and ref
      isRestingRef.current = true;
      setIsResting(true);
      onRestStart?.(trial);
      runTimer(REST_DURATION_MS, advanceSequence);
    }
  }, [
    totalTrials,
    onWordStart,
    onWordEnd,
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
    currentWordIndexRef.current = 0;
    isRestingRef.current = false;
    setCurrentTrial(1);
    setCurrentWordIndex(0);
    setIsResting(false);

    // Start with first word
    const word = WORDS[0];
    onWordStart?.(word.name, word.id, 1);
    runTimer(WORD_DURATION_MS, advanceSequence);
  }, [onWordStart, runTimer, advanceSequence]);

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
    currentWordIndexRef.current = 0;
    isRestingRef.current = false;
    setCurrentTrial(1);
    setCurrentWordIndex(0);
    setIsResting(false);
  }, [stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
      isRunningRef.current = false;
    };
  }, [clearTimer]);

  // Get current word
  const currentWord = isResting ? null : WORDS[currentWordIndex];

  return {
    isRunning,
    currentTrial,
    currentWordIndex,
    currentWord,
    isResting,
    start,
    stop,
    reset,
  };
}
