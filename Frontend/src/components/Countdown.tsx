/**
 * BCI Data Collection - Countdown Component
 * Displays 3-2-1 countdown before starting color presentation.
 */

import { useEffect, useState } from 'react';
import { COUNTDOWN_DURATION_S } from '../constants/colors';

interface CountdownProps {
  onComplete: () => void;
}

export function Countdown({ onComplete }: CountdownProps) {
  const [count, setCount] = useState(COUNTDOWN_DURATION_S);

  useEffect(() => {
    if (count === 0) {
      onComplete();
      return;
    }

    const timer = setTimeout(() => {
      setCount((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [count, onComplete]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="text-center">
        <div
          className="text-[200px] font-bold text-white leading-none animate-pulse"
          style={{
            textShadow: '0 0 60px rgba(255,255,255,0.5)',
          }}
        >
          {count}
        </div>
        <p className="text-gray-400 text-xl mt-8">Get ready...</p>
      </div>
    </div>
  );
}
