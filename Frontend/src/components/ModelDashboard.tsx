/**
 * BCI Data Collection - Model Dashboard
 * Train, evaluate, and inspect the EEG-to-text model.
 * Tabs: Sessions (playback + select) | Training (progress) | Model Info
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import type {
  ModelCheckpointInfo,
  SessionEvent,
  SessionMeta,
  TrainingStatusResponse,
  WordPrediction,
} from '../types/session';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Playback Modal ──────────────────────────────────────────────────────────────

function PlaybackModal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/session/${sessionId}/events`)
      .then((r) => r.json())
      .then((data) => {
        setEvents(data.events ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [sessionId]);

  const wordEvents = events.filter((e) => e.event === 'word_start');

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h3 className="text-white font-semibold">Session Playback</h3>
            <p className="text-gray-400 text-xs font-mono">{sessionId}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-gray-600 text-gray-300"
          >
            Close
          </Button>
        </div>
        <div className="overflow-auto p-4">
          {loading ? (
            <p className="text-gray-400 text-sm">Loading events...</p>
          ) : wordEvents.length === 0 ? (
            <p className="text-gray-400 text-sm">No word events found in this session.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700 text-left">
                  <th className="py-2 pr-4">Trial</th>
                  <th className="py-2 pr-4">Word</th>
                  <th className="py-2">Start (ms)</th>
                </tr>
              </thead>
              <tbody>
                {wordEvents.map((e, i) => (
                  <tr key={i} className="border-b border-gray-700/40 text-gray-200">
                    <td className="py-1.5 pr-4 text-gray-400">{e.trial}</td>
                    <td className="py-1.5 pr-4 font-mono font-semibold text-green-400">
                      {e.word}
                    </td>
                    <td className="py-1.5 text-gray-400 font-mono text-xs">
                      {e.relative_time_ms}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Predictions Modal ───────────────────────────────────────────────────────────

function PredictionsModal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [predictions, setPredictions] = useState<WordPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/session/${sessionId}/predict`)
      .then((r) => {
        if (!r.ok) throw new Error('Model not trained or session not found');
        return r.json();
      })
      .then((data) => {
        setPredictions(data.predictions ?? []);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [sessionId]);

  const correct = predictions.filter(
    (p) => p.predicted.toUpperCase() === p.word.toUpperCase(),
  ).length;
  const withEEG = predictions.filter((p) => p.has_eeg).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h3 className="text-white font-semibold">Model Predictions</h3>
            <p className="text-gray-400 text-xs font-mono">{sessionId}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-gray-600 text-gray-300"
          >
            Close
          </Button>
        </div>
        <div className="overflow-auto p-4">
          {loading && <p className="text-gray-400 text-sm">Running inference...</p>}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {!loading && !error && predictions.length === 0 && (
            <p className="text-gray-400 text-sm">No predictions available.</p>
          )}
          {!loading && !error && predictions.length > 0 && (
            <>
              <div className="flex gap-4 mb-3 text-sm">
                <span className="text-gray-400">
                  Words with EEG: <span className="text-white font-medium">{withEEG}</span>
                </span>
                {withEEG > 0 && (
                  <span className="text-gray-400">
                    Accuracy:{' '}
                    <span className="text-green-400 font-medium">
                      {Math.round((correct / withEEG) * 100)}%
                    </span>
                  </span>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700 text-left">
                    <th className="py-2 pr-3">Trial</th>
                    <th className="py-2 pr-3">True Word</th>
                    <th className="py-2 pr-3">Predicted</th>
                    <th className="py-2 pr-3">Confidence</th>
                    <th className="py-2">EEG</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((p, i) => {
                    const match = p.predicted.toUpperCase() === p.word.toUpperCase();
                    return (
                      <tr key={i} className="border-b border-gray-700/40">
                        <td className="py-1.5 pr-3 text-gray-400">{p.trial}</td>
                        <td className="py-1.5 pr-3 font-mono font-semibold text-white">
                          {p.word}
                        </td>
                        <td
                          className={`py-1.5 pr-3 font-mono font-semibold ${
                            !p.has_eeg
                              ? 'text-gray-500'
                              : match
                                ? 'text-green-400'
                                : 'text-red-400'
                          }`}
                        >
                          {p.predicted}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-400 font-mono text-xs">
                          {p.has_eeg ? `${(p.confidence * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-1.5 text-xs">
                          {p.has_eeg ? (
                            <span className="text-green-400">✓</span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ──────────────────────────────────────────────────────────────

interface ModelDashboardProps {
  onBack: () => void;
  preSelectedSessionId?: string | null;
}

export function ModelDashboard({ onBack, preSelectedSessionId }: ModelDashboardProps) {
  const [activeTab, setActiveTab] = useState('sessions');
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [epochs, setEpochs] = useState(50);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [playbackSessionId, setPlaybackSessionId] = useState<string | null>(null);
  const [predictionSessionId, setPredictionSessionId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/sessions/all`);
      const data: SessionMeta[] = await res.json();
      setSessions(data);
      if (preSelectedSessionId) {
        setSelectedIds((prev) => new Set([...prev, preSelectedSessionId]));
      }
    } catch {
      // server may not be up yet
    } finally {
      setSessionsLoading(false);
    }
  }, [preSelectedSessionId]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/model/status`);
      const data: TrainingStatusResponse = await res.json();
      setTrainingStatus(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadStatus();
  }, [loadSessions, loadStatus]);

  // Poll every 2 s while training is active
  useEffect(() => {
    if (trainingStatus?.status === 'training') {
      pollRef.current = window.setInterval(loadStatus, 2000);
    } else {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [trainingStatus?.status, loadStatus]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStartTraining = async () => {
    if (selectedIds.size === 0) {
      alert('Select at least one session in the Sessions tab first.');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/model/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_ids: [...selectedIds], epochs }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail ?? 'Failed to start training');
        return;
      }
      await loadStatus();
    } catch {
      alert('Failed to reach the backend. Is the server running?');
    }
  };

  const handleStopTraining = async () => {
    await fetch(`${API_URL}/api/model/stop`, { method: 'POST' });
    await loadStatus();
  };

  const isTraining = trainingStatus?.status === 'training';
  const ckpt: ModelCheckpointInfo | undefined = trainingStatus?.checkpoint;
  const progressPct =
    trainingStatus && trainingStatus.total_epochs > 0
      ? Math.round((trainingStatus.current_epoch / trainingStatus.total_epochs) * 100)
      : 0;

  const statusColor = {
    idle: 'text-gray-400',
    training: 'text-yellow-400',
    complete: 'text-green-400',
    error: 'text-red-400',
  } as const;

  return (
    <div className="min-h-screen bg-gray-900 p-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="outline"
            onClick={onBack}
            className="border-gray-600 text-gray-200 hover:bg-gray-700"
          >
            ← Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">Model Dashboard</h1>
            <p className="text-gray-400 text-sm">Train and evaluate the EEG-to-text model</p>
          </div>
          {ckpt?.exists && (
            <span className="ml-auto text-xs text-green-400 bg-green-900/30 px-3 py-1 rounded-full">
              ✓ Checkpoint: epoch {(ckpt.epoch ?? 0) + 1}
            </span>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-gray-800 mb-4">
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="training">
              Training{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </TabsTrigger>
            <TabsTrigger value="model">Model Info</TabsTrigger>
          </TabsList>

          {/* ── Sessions Tab ─────────────────────────────────────────────── */}
          <TabsContent value="sessions">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-white">Recorded Sessions</h2>
                <div className="flex gap-2">
                  {selectedIds.size > 0 && (
                    <Button
                      size="sm"
                      onClick={() => setActiveTab('training')}
                      className="bg-green-600 hover:bg-green-700 text-xs h-7"
                    >
                      Train on {selectedIds.size} selected →
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadSessions}
                    className="border-gray-600 text-gray-300 text-xs h-7"
                  >
                    Refresh
                  </Button>
                </div>
              </div>

              {sessionsLoading ? (
                <p className="text-gray-400 text-sm">Loading sessions...</p>
              ) : sessions.length === 0 ? (
                <p className="text-gray-400 text-sm">
                  No sessions found. Record a session first.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-700 text-left">
                        <th className="py-2 pr-3 w-8">
                          <input
                            type="checkbox"
                            checked={sessions.every((s) => selectedIds.has(s.session_id))}
                            onChange={(e) => {
                              if (e.target.checked)
                                setSelectedIds(new Set(sessions.map((s) => s.session_id)));
                              else setSelectedIds(new Set());
                            }}
                            className="w-4 h-4 accent-green-500"
                          />
                        </th>
                        <th className="py-2 pr-4">Session ID</th>
                        <th className="py-2 pr-4">Participant</th>
                        <th className="py-2 pr-4">Trials</th>
                        <th className="py-2 pr-4">Date</th>
                        <th className="py-2 pr-4">EEG</th>
                        <th className="py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr
                          key={s.session_id}
                          className="border-b border-gray-700/50 text-gray-200 hover:bg-gray-700/30"
                        >
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(s.session_id)}
                              onChange={() => toggleSelect(s.session_id)}
                              className="w-4 h-4 accent-green-500"
                            />
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs text-gray-300">
                            {s.session_id}
                          </td>
                          <td className="py-2 pr-4">{s.participant_name ?? '—'}</td>
                          <td className="py-2 pr-4">{s.total_trials ?? '—'}</td>
                          <td className="py-2 pr-4 text-xs text-gray-400">
                            {s.start_time ? s.start_time.split('T')[0] : '—'}
                          </td>
                          <td className="py-2 pr-4">
                            {s.eeg_enabled === 'true' ? (
                              <span className="text-green-400 text-xs">✓ EEG</span>
                            ) : (
                              <span className="text-gray-600 text-xs">—</span>
                            )}
                          </td>
                          <td className="py-2">
                            <div className="flex gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPlaybackSessionId(s.session_id)}
                                className="border-gray-600 text-gray-300 text-xs h-7 px-2"
                              >
                                Playback
                              </Button>
                              {ckpt?.exists && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setPredictionSessionId(s.session_id)}
                                  className="border-blue-700 text-blue-300 text-xs h-7 px-2"
                                >
                                  Predict
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Training Tab ─────────────────────────────────────────────── */}
          <TabsContent value="training">
            <div className="space-y-4">
              {/* Config card */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h2 className="font-semibold text-white mb-4">Training Configuration</h2>
                <div className="flex flex-wrap gap-6 items-end">
                  <div>
                    <p className="text-sm text-gray-400 mb-1">Sessions selected</p>
                    {selectedIds.size === 0 ? (
                      <p className="text-yellow-400 text-sm">
                        None —{' '}
                        <button
                          className="underline"
                          onClick={() => setActiveTab('sessions')}
                        >
                          go to Sessions tab
                        </button>
                      </p>
                    ) : (
                      <p className="text-white font-medium text-sm">
                        {selectedIds.size} session{selectedIds.size > 1 ? 's' : ''}
                      </p>
                    )}
                    {selectedIds.size > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5 max-w-xs truncate">
                        {[...selectedIds].join(', ')}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Epochs</label>
                    <input
                      type="number"
                      value={epochs}
                      min={1}
                      max={1000}
                      onChange={(e) =>
                        setEpochs(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))
                      }
                      disabled={isTraining}
                      className="w-24 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm disabled:opacity-50"
                    />
                  </div>

                  <div>
                    {!isTraining ? (
                      <Button
                        onClick={handleStartTraining}
                        className="bg-green-600 hover:bg-green-700"
                        disabled={selectedIds.size === 0}
                      >
                        Start Training
                      </Button>
                    ) : (
                      <Button variant="destructive" onClick={handleStopTraining}>
                        Stop Training
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress card */}
              {trainingStatus && trainingStatus.status !== 'idle' && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="font-semibold text-white">Progress</h2>
                    <span
                      className={`text-sm font-medium ${statusColor[trainingStatus.status] ?? 'text-gray-400'}`}
                    >
                      {trainingStatus.status === 'training'
                        ? 'Training…'
                        : trainingStatus.status === 'complete'
                          ? 'Complete'
                          : trainingStatus.status === 'error'
                            ? 'Error'
                            : 'Idle'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                    <span>Epoch {trainingStatus.current_epoch} / {trainingStatus.total_epochs}</span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">Loss</p>
                      <p className="text-white font-mono">{trainingStatus.loss.toFixed(4)}</p>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">Exact-match Accuracy</p>
                      <p className="text-white font-mono">{trainingStatus.accuracy.toFixed(1)}%</p>
                    </div>
                  </div>

                  {trainingStatus.error && (
                    <p className="text-red-400 text-sm mt-3">{trainingStatus.error}</p>
                  )}
                </div>
              )}

              {/* Epoch log */}
              {trainingStatus && trainingStatus.log.length > 0 && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h2 className="font-semibold text-white mb-3">Epoch Log</h2>
                  <div className="overflow-auto max-h-56">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-700 text-left">
                          <th className="py-1 pr-6">Epoch</th>
                          <th className="py-1 pr-6">Loss</th>
                          <th className="py-1">Accuracy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...trainingStatus.log].reverse().map((entry) => (
                          <tr
                            key={entry.epoch}
                            className="border-b border-gray-700/30 text-gray-300"
                          >
                            <td className="py-1 pr-6">{entry.epoch}</td>
                            <td className="py-1 pr-6 font-mono">{entry.loss.toFixed(4)}</td>
                            <td className="py-1 font-mono">{entry.accuracy.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Model Info Tab ────────────────────────────────────────────── */}
          <TabsContent value="model">
            <div className="bg-gray-800 rounded-lg p-4">
              <h2 className="font-semibold text-white mb-4">Model Information</h2>
              {!trainingStatus ? (
                <p className="text-gray-400 text-sm">Loading…</p>
              ) : !ckpt?.exists ? (
                <div className="text-center py-10">
                  <p className="text-gray-400 mb-2">No trained model checkpoint found.</p>
                  <p className="text-gray-500 text-sm">
                    Select sessions and start training to create one.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4 border-gray-600 text-gray-300"
                    onClick={() => setActiveTab('sessions')}
                  >
                    Go to Sessions
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">Checkpoint</p>
                      <p className="text-green-400 font-medium">Loaded</p>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">Trained Epochs</p>
                      <p className="text-white font-mono">{(ckpt.epoch ?? 0) + 1}</p>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">Vocabulary Size</p>
                      <p className="text-white font-mono">{ckpt.vocab_size}</p>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">Architecture</p>
                      <p className="text-white text-xs">EEGNet + BiLSTM (16ch → 11 classes)</p>
                    </div>
                  </div>

                  {ckpt.vocab && (
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-2">Vocabulary</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ckpt.vocab
                          .filter((w) => w !== '<blank>')
                          .map((w) => (
                            <span
                              key={w}
                              className="px-2 py-0.5 bg-gray-600 rounded text-xs text-white font-mono"
                            >
                              {w}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-700/50 rounded p-3">
                    <p className="text-gray-400 text-xs mb-2">
                      To run inference on a session, go to the{' '}
                      <button
                        className="text-blue-400 underline"
                        onClick={() => setActiveTab('sessions')}
                      >
                        Sessions tab
                      </button>{' '}
                      and click <span className="text-blue-300">Predict</span>.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Modals */}
      {playbackSessionId && (
        <PlaybackModal
          sessionId={playbackSessionId}
          onClose={() => setPlaybackSessionId(null)}
        />
      )}
      {predictionSessionId && (
        <PredictionsModal
          sessionId={predictionSessionId}
          onClose={() => setPredictionSessionId(null)}
        />
      )}
    </div>
  );
}
