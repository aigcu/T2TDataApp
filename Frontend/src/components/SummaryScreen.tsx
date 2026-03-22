/**
 * BCI Data Collection - Summary Screen Component
 * Displays session results and provides save/delete options.
 */

import { useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import type { SessionSummary } from '../types/session';

interface SummaryScreenProps {
  summary: SessionSummary;
  onSave: () => void;
  onDelete: () => void;
  onNewSession: () => void;
  onGoToModel?: () => void;
}

export function SummaryScreen({
  summary,
  onSave,
  onDelete,
  onNewSession,
  onGoToModel,
}: SummaryScreenProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    setShowDeleteDialog(false);
    onDelete();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <div className="w-full max-w-lg bg-gray-800 rounded-lg shadow-lg p-8">
        {/* Success Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Session Complete!</h1>
          <p className="text-gray-300 mt-1">Your data has been recorded successfully.</p>
        </div>

        {/* Session Info */}
        <div className="bg-gray-700/50 rounded-lg p-4 mb-6">
          <h2 className="font-semibold text-white mb-3">Participant Info</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-gray-400">Name:</div>
            <div className="font-medium text-gray-200">{summary.participant_name}</div>

            <div className="text-gray-400">Age:</div>
            <div className="font-medium text-gray-200">{summary.participant_age}</div>

            <div className="text-gray-400">Sex:</div>
            <div className="font-medium text-gray-200">{summary.participant_sex}</div>

            <div className="text-gray-400">Gender:</div>
            <div className="font-medium text-gray-200">{summary.participant_gender}</div>

            <div className="text-gray-400">Race:</div>
            <div className="font-medium text-gray-200">{summary.participant_race}</div>
          </div>
        </div>

        {/* Session Stats */}
        <div className="bg-gray-700/50 rounded-lg p-4 mb-6">
          <h2 className="font-semibold text-white mb-3">Session Statistics</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-gray-400">Total Trials:</div>
            <div className="font-medium text-gray-200">{summary.total_trials}</div>

            <div className="text-gray-400">Words Presented:</div>
            <div className="font-medium text-gray-200">{summary.words_presented}</div>

            <div className="text-gray-400">Rest Periods:</div>
            <div className="font-medium text-gray-200">{summary.rest_periods}</div>

            <div className="text-gray-400">Total Duration:</div>
            <div className="font-medium text-gray-200">{formatDuration(summary.total_duration_ms)}</div>

            <div className="text-gray-400">Session ID:</div>
            <div className="font-medium font-mono text-xs text-gray-200">{summary.session_id}</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            onClick={handleSave}
            className="flex-1 bg-green-600 hover:bg-green-700"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Data'}
          </Button>

          <Button
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
            className="flex-1"
          >
            Delete Data
          </Button>
        </div>

        {/* Train Model Button */}
        {onGoToModel && (
          <Button
            variant="outline"
            onClick={onGoToModel}
            className="w-full mt-3 border-blue-700 text-blue-300 hover:bg-blue-900/30"
          >
            Add to Training Data &amp; Open Model Dashboard
          </Button>
        )}

        {/* New Session Button */}
        <Button
          variant="outline"
          onClick={onNewSession}
          className="w-full mt-3 border-gray-600 text-gray-200 hover:bg-gray-700"
        >
          Start New Session
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Session Data?</DialogTitle>
            <DialogDescription>
              Are you sure? This will permanently delete all session data. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Yes, Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
