/**
 * BCI Data Collection - Word Presentation Component
 * Displays fullscreen word stimulus or blank white rest screen.
 */

import { useState } from 'react';
import type { WordDefinition } from '../constants/colors';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';

interface WordPresentationProps {
  currentWord: WordDefinition | null;
  isResting: boolean;
  currentTrial: number;
  totalTrials: number;
  onStop: () => void;
}

export function WordPresentation({
  currentWord,
  isResting,
  currentTrial,
  totalTrials,
  onStop,
}: WordPresentationProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleConfirmStop = () => {
    setShowConfirm(false);
    onStop();
  };

  // Stop button shown on both word and rest screens
  const stopButton = (
    <button
      onClick={() => setShowConfirm(true)}
      className="absolute top-4 left-4 z-60 text-xs font-medium px-3 py-1 rounded-full
                 bg-black/40 text-white/80 hover:bg-red-600/80 hover:text-white
                 transition-colors duration-150 select-none"
      aria-label="Stop session"
    >
      ✕ Stop
    </button>
  );

  // Confirmation dialog (rendered regardless of screen type)
  const confirmDialog = (
    <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop Session?</DialogTitle>
          <DialogDescription>
            This will stop the current session and permanently delete all recorded data.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowConfirm(false)}>
            Keep Going
          </Button>
          <Button variant="destructive" onClick={handleConfirmStop}>
            Stop &amp; Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // Rest screen - blank white with hidden stop button
  if (isResting) {
    return (
      <div className="fixed inset-0 z-50 bg-white">
        {stopButton}
        {confirmDialog}
      </div>
    );
  }

  // Word stimulus screen
  if (!currentWord) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900">
      {/* Word label - large, centered */}
      <div className="text-9xl font-bold tracking-widest text-white select-none">
        {currentWord.name}
      </div>

      {/* Progress indicator - top-right */}
      <div className="absolute top-4 right-4 text-sm font-medium px-3 py-1 rounded-full bg-black/40 text-white">
        Trial {currentTrial} of {totalTrials}
      </div>

      {/* Stop button - top-left */}
      {stopButton}
      {confirmDialog}
    </div>
  );
}
