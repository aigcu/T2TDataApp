/**
 * BCI Data Collection - Color Presentation Component
 * Displays fullscreen color stimulus or blank white rest screen.
 */

import { REST_COLOR, type ColorDefinition } from '../constants/colors';

interface ColorPresentationProps {
  currentColor: ColorDefinition | null;
  isResting: boolean;
  currentTrial: number;
  totalTrials: number;
}

export function ColorPresentation({
  currentColor,
  isResting,
  currentTrial,
  totalTrials,
}: ColorPresentationProps) {
  // Rest screen - completely blank white, no UI elements
  if (isResting) {
    return (
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: REST_COLOR }}
      />
    );
  }

  // Color stimulus screen
  if (!currentColor) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: currentColor.hex }}
    >
      {/* Color name label */}
      <div
        className="text-8xl font-bold tracking-wider"
        style={{ color: currentColor.textColor }}
      >
        {currentColor.name}
      </div>

      {/* Progress indicator - small, top-right corner */}
      <div
        className="absolute top-4 right-4 text-sm font-medium px-3 py-1 rounded-full"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          color: '#FFFFFF',
        }}
      >
        Trial {currentTrial} of {totalTrials}
      </div>
    </div>
  );
}
