/**
 * BCI Data Collection - Ready Screen Component
 * Displays instructions and waits for user to start the session.
 */

import { useMemo } from 'react';
import { Button } from './ui/button';
import type { EEGStatus } from '../types/session';

interface ReadyScreenProps {
  onStart: () => void;
  participantName: string;
  totalTrials: number;
  eegStatus: EEGStatus;
  onConnectEEG: () => void;
}

export function ReadyScreen({
  onStart,
  participantName,
  totalTrials,
  eegStatus,
  onConnectEEG,
}: ReadyScreenProps) {
  const eegStatusDisplay = useMemo(() => {
    switch (eegStatus) {
      case 'connected':
        return {
          icon: '●',
          text: 'EEG Connected (16 channels, 125 Hz)',
          color: 'text-green-400',
          bgColor: 'bg-green-900/30',
        };
      case 'streaming':
        return {
          icon: '◉',
          text: 'EEG Streaming',
          color: 'text-green-400',
          bgColor: 'bg-green-900/30',
        };
      case 'connecting':
        return {
          icon: '○',
          text: 'Connecting to EEG...',
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-900/30',
        };
      case 'error':
        return {
          icon: '✕',
          text: 'EEG Connection Error',
          color: 'text-red-400',
          bgColor: 'bg-red-900/30',
        };
      case 'disconnected':
      default:
        return {
          icon: '○',
          text: 'EEG Not Connected',
          color: 'text-gray-400',
          bgColor: 'bg-gray-800/50',
        };
    }
  }, [eegStatus]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <div className="w-full max-w-lg text-center">
        <h1 className="text-4xl font-bold text-white mb-4">Ready to begin?</h1>

        <p className="text-gray-300 mb-2">
          Welcome, <span className="text-white font-semibold">{participantName}</span>
        </p>

        <div className="bg-gray-800 rounded-lg p-6 mb-8 text-left">
          <h2 className="text-lg font-semibold text-white mb-4">Instructions:</h2>
          <ul className="space-y-3 text-gray-300">
            <li className="flex items-start">
              <span className="text-green-400 mr-2">•</span>
              <span>You will see <span className="text-white font-medium">10 different words</span> displayed one at a time</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-400 mr-2">•</span>
              <span>Focus on each word and <span className="text-white font-medium">think about its meaning</span> for 5 seconds</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-400 mr-2">•</span>
              <span>Between words, you'll see a <span className="text-white font-medium">blank white screen</span> - relax during this rest</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-400 mr-2">•</span>
              <span>Try to <span className="text-white font-medium">minimize movement</span> during the session</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-400 mr-2">•</span>
              <span>This sequence will repeat for <span className="text-white font-medium">{totalTrials} trials</span></span>
            </li>
          </ul>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
          <p className="text-sm text-gray-400 mb-3">
            The words will be shown in this order:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {['YES', 'NO', 'HELP', 'STOP', 'GO', 'WATER', 'FOOD', 'PAIN', 'MORE', 'NEED'].map((word) => (
              <span
                key={word}
                className="px-3 py-1 rounded bg-gray-700 text-white text-sm font-mono font-semibold border border-gray-600"
              >
                {word}
              </span>
            ))}
          </div>
        </div>

        {/* EEG Status Section */}
        <div className={`rounded-lg p-4 mb-8 ${eegStatusDisplay.bgColor}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-xl ${eegStatusDisplay.color}`}>
                {eegStatusDisplay.icon}
              </span>
              <span className={eegStatusDisplay.color}>
                {eegStatusDisplay.text}
              </span>
            </div>

            {(eegStatus === 'disconnected' || eegStatus === 'error') && (
              <Button
                variant="outline"
                size="sm"
                onClick={onConnectEEG}
                className="border-gray-600 hover:bg-gray-700"
              >
                {eegStatus === 'error' ? 'Retry' : 'Connect EEG'}
              </Button>
            )}
          </div>

          {eegStatus === 'disconnected' && (
            <p className="text-xs text-gray-500 mt-2 text-left">
              Session will proceed without EEG data if hardware is not connected.
            </p>
          )}
        </div>

        <Button
          onClick={onStart}
          size="lg"
          className="text-xl px-12 py-6 h-auto bg-green-600 hover:bg-green-700"
        >
          START
        </Button>

        <p className="text-gray-500 text-sm mt-4">Press the button when you're ready</p>
      </div>
    </div>
  );
}
