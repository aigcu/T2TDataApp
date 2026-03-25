/**
 * BCI Data Collection - Model Dashboard
 * Train, evaluate, and inspect the EEG-to-text model.
 * Tabs: Sessions (playback + quality) | Training (expert config + progress) | Model Info
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import type {
  CheckpointMeta,
  ModelCheckpointInfo,
  SessionEvent,
  SessionMeta,
  TrainingConfig,
  TrainingStatusResponse,
  WordPrediction,
} from '../types/session';
import { DEFAULT_TRAINING_CONFIG } from '../types/session';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── EEG Quality Badge ─────────────────────────────────────────────────────────

function EEGQualityBadge({ count, enabled }: { count?: number; enabled?: string }) {
  if (enabled !== 'true') return <span className="text-gray-600 text-xs">No EEG</span>;
  if (count === undefined) return null;
  if (count >= 500) return <span className="text-green-400 text-xs font-medium">Good ({count})</span>;
  if (count >= 100) return <span className="text-yellow-400 text-xs font-medium">Fair ({count})</span>;
  return <span className="text-red-400 text-xs font-medium">Low ({count})</span>;
}

// ── Playback Modal ────────────────────────────────────────────────────────────

function PlaybackModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/session/${sessionId}/events`)
      .then((r) => r.json())
      .then((data) => { setEvents(data.events ?? []); setLoading(false); })
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
          <Button variant="outline" size="sm" onClick={onClose} className="border-gray-600 text-gray-300">Close</Button>
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
                    <td className="py-1.5 pr-4 font-mono font-semibold text-green-400">{e.word}</td>
                    <td className="py-1.5 text-gray-400 font-mono text-xs">{e.relative_time_ms}</td>
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

// ── Predictions Modal ─────────────────────────────────────────────────────────

function PredictionsModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [predictions, setPredictions] = useState<WordPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/session/${sessionId}/predict`)
      .then((r) => { if (!r.ok) throw new Error('Model not trained or session not found'); return r.json(); })
      .then((data) => { setPredictions(data.predictions ?? []); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [sessionId]);

  const withEEG = predictions.filter((p) => p.has_eeg).length;
  const correct = predictions.filter((p) => p.has_eeg && p.predicted.toUpperCase() === p.word.toUpperCase()).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h3 className="text-white font-semibold">Model Predictions</h3>
            <p className="text-gray-400 text-xs font-mono">{sessionId}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose} className="border-gray-600 text-gray-300">Close</Button>
        </div>
        <div className="overflow-auto p-4">
          {loading && <p className="text-gray-400 text-sm">Running inference...</p>}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {!loading && !error && predictions.length === 0 && <p className="text-gray-400 text-sm">No predictions available.</p>}
          {!loading && !error && predictions.length > 0 && (
            <>
              <div className="flex gap-4 mb-3 text-sm">
                <span className="text-gray-400">EEG windows: <span className="text-white font-medium">{withEEG}</span></span>
                {withEEG > 0 && (
                  <span className="text-gray-400">Accuracy: <span className="text-green-400 font-medium">{Math.round((correct / withEEG) * 100)}%</span></span>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700 text-left">
                    <th className="py-2 pr-3">Trial</th>
                    <th className="py-2 pr-3">True</th>
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
                        <td className="py-1.5 pr-3 font-mono font-semibold text-white">{p.word}</td>
                        <td className={`py-1.5 pr-3 font-mono font-semibold ${!p.has_eeg ? 'text-gray-500' : match ? 'text-green-400' : 'text-red-400'}`}>
                          {p.predicted}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-400 font-mono text-xs">
                          {p.has_eeg ? `${(p.confidence * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-1.5 text-xs">
                          {p.has_eeg ? <span className="text-green-400">✓</span> : <span className="text-gray-600">—</span>}
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function ConfigInput({
  label, value, onChange, type = 'number', min, max, step, disabled,
}: {
  label: string; value: number | string; onChange: (v: string) => void;
  type?: string; min?: number; max?: number; step?: number; disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm disabled:opacity-40"
      />
    </div>
  );
}

function AugToggle({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 cursor-pointer ${disabled ? 'opacity-40' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-4 h-4 accent-green-500"
      />
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

interface ModelDashboardProps {
  onBack: () => void;
  preSelectedSessionId?: string | null;
}

export function ModelDashboard({ onBack, preSelectedSessionId }: ModelDashboardProps) {
  const [activeTab, setActiveTab] = useState('sessions');
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [epochs, setEpochs] = useState(50);
  const [config, setConfig] = useState<TrainingConfig>({ ...DEFAULT_TRAINING_CONFIG });
  const [configOpen, setConfigOpen] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [playbackSessionId, setPlaybackSessionId] = useState<string | null>(null);
  const [predictionSessionId, setPredictionSessionId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const setConfigField = <K extends keyof TrainingConfig>(key: K, val: TrainingConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: val }));

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/sessions/all`);
      const data: SessionMeta[] = await res.json();
      setSessions(data);
      if (preSelectedSessionId) {
        setSelectedIds((prev) => new Set([...prev, preSelectedSessionId]));
      }
    } catch { /* server may not be up yet */ }
    finally { setSessionsLoading(false); }
  }, [preSelectedSessionId]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/model/status`);
      const data: TrainingStatusResponse = await res.json();
      setTrainingStatus(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSessions(); loadStatus(); }, [loadSessions, loadStatus]);

  useEffect(() => {
    if (trainingStatus?.status === 'training') {
      pollRef.current = window.setInterval(loadStatus, 2000);
    } else {
      if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current !== null) clearInterval(pollRef.current); };
  }, [trainingStatus?.status, loadStatus]);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleStartTraining = async () => {
    if (selectedIds.size === 0) { alert('Select at least one session first.'); return; }
    try {
      const res = await fetch(`${API_URL}/api/model/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_ids: [...selectedIds],
          epochs,
          ...config,
        }),
      });
      if (!res.ok) { const err = await res.json(); alert(err.detail ?? 'Failed to start training'); return; }
      await loadStatus();
    } catch { alert('Failed to reach the backend. Is the server running?'); }
  };

  const handleStopTraining = async () => {
    await fetch(`${API_URL}/api/model/stop`, { method: 'POST' });
    await loadStatus();
  };

  const handleLoadCheckpoint = async (name: string) => {
    const res = await fetch(`${API_URL}/api/model/load/${encodeURIComponent(name)}`, { method: 'POST' });
    if (res.ok) { await loadStatus(); }
    else { alert('Failed to load checkpoint'); }
  };

  const isTraining = trainingStatus?.status === 'training';
  const ckpt: ModelCheckpointInfo | undefined = trainingStatus?.checkpoint;
  const progressPct = trainingStatus && trainingStatus.total_epochs > 0
    ? Math.round((trainingStatus.current_epoch / trainingStatus.total_epochs) * 100)
    : 0;

  const statusColor: Record<string, string> = {
    idle: 'text-gray-400', training: 'text-yellow-400', complete: 'text-green-400', error: 'text-red-400',
  };
  const statusLabel: Record<string, string> = {
    idle: 'Idle', training: 'Training…', complete: 'Complete', error: 'Error',
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" onClick={onBack} className="border-gray-600 text-gray-200 hover:bg-gray-700">
            ← Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">Model Dashboard</h1>
            <p className="text-gray-400 text-sm">EEGConformer — EEG-to-text training &amp; evaluation</p>
          </div>
          {ckpt?.exists && (
            <span className="ml-auto text-xs text-green-400 bg-green-900/30 px-3 py-1 rounded-full">
              Best checkpoint: epoch {(ckpt.epoch ?? 0) + 1}
              {ckpt.best_val_loss != null ? ` · val ${ckpt.best_val_loss.toFixed(4)}` : ''}
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

          {/* ── Sessions Tab ──────────────────────────────────────────────── */}
          <TabsContent value="sessions">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-white">Recorded Sessions</h2>
                <div className="flex gap-2">
                  {selectedIds.size > 0 && (
                    <Button size="sm" onClick={() => setActiveTab('training')} className="bg-green-600 hover:bg-green-700 text-xs h-7">
                      Train on {selectedIds.size} selected →
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={loadSessions} className="border-gray-600 text-gray-300 text-xs h-7">
                    Refresh
                  </Button>
                </div>
              </div>

              {sessionsLoading ? (
                <p className="text-gray-400 text-sm">Loading sessions...</p>
              ) : sessions.length === 0 ? (
                <p className="text-gray-400 text-sm">No sessions found. Record a session first.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-700 text-left">
                        <th className="py-2 pr-3 w-8">
                          <input
                            type="checkbox"
                            checked={sessions.length > 0 && sessions.every((s) => selectedIds.has(s.session_id))}
                            onChange={(e) => e.target.checked
                              ? setSelectedIds(new Set(sessions.map((s) => s.session_id)))
                              : setSelectedIds(new Set())
                            }
                            className="w-4 h-4 accent-green-500"
                          />
                        </th>
                        <th className="py-2 pr-4">Session ID</th>
                        <th className="py-2 pr-4">Participant</th>
                        <th className="py-2 pr-4">Trials</th>
                        <th className="py-2 pr-4">Date</th>
                        <th className="py-2 pr-4">EEG Quality</th>
                        <th className="py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr key={s.session_id} className="border-b border-gray-700/50 text-gray-200 hover:bg-gray-700/30">
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(s.session_id)}
                              onChange={() => toggleSelect(s.session_id)}
                              className="w-4 h-4 accent-green-500"
                            />
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs text-gray-300">{s.session_id}</td>
                          <td className="py-2 pr-4">{s.participant_name ?? '—'}</td>
                          <td className="py-2 pr-4">{s.total_trials ?? '—'}</td>
                          <td className="py-2 pr-4 text-xs text-gray-400">
                            {s.start_time ? s.start_time.split('T')[0] : '—'}
                          </td>
                          <td className="py-2 pr-4">
                            <EEGQualityBadge count={s.eeg_sample_count} enabled={s.eeg_enabled} />
                          </td>
                          <td className="py-2">
                            <div className="flex gap-1.5">
                              <Button
                                variant="outline" size="sm"
                                onClick={() => setPlaybackSessionId(s.session_id)}
                                className="border-gray-600 text-gray-300 text-xs h-7 px-2"
                              >
                                Playback
                              </Button>
                              {ckpt?.exists && (
                                <Button
                                  variant="outline" size="sm"
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

          {/* ── Training Tab ──────────────────────────────────────────────── */}
          <TabsContent value="training">
            <div className="space-y-4">
              {/* Config card */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h2 className="font-semibold text-white mb-4">Training Configuration</h2>

                {/* Sessions + Epochs + Start/Stop */}
                <div className="flex flex-wrap gap-6 items-end mb-4">
                  <div>
                    <p className="text-sm text-gray-400 mb-1">Sessions selected</p>
                    {selectedIds.size === 0 ? (
                      <p className="text-yellow-400 text-sm">
                        None — <button className="underline" onClick={() => setActiveTab('sessions')}>go to Sessions tab</button>
                      </p>
                    ) : (
                      <p className="text-white font-medium text-sm">{selectedIds.size} session{selectedIds.size > 1 ? 's' : ''}</p>
                    )}
                    {selectedIds.size > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5 max-w-xs truncate">{[...selectedIds].join(', ')}</p>
                    )}
                  </div>
                  <div className="w-24">
                    <label className="block text-sm text-gray-400 mb-1">Epochs</label>
                    <input
                      type="number" value={epochs} min={1} max={1000}
                      onChange={(e) => setEpochs(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                      disabled={isTraining}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm disabled:opacity-50"
                    />
                  </div>
                  <div>
                    {!isTraining ? (
                      <Button onClick={handleStartTraining} className="bg-green-600 hover:bg-green-700" disabled={selectedIds.size === 0}>
                        Start Training
                      </Button>
                    ) : (
                      <Button variant="destructive" onClick={handleStopTraining}>Stop Training</Button>
                    )}
                  </div>
                </div>

                {/* Advanced config accordion */}
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-700/50 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                    onClick={() => setConfigOpen((o) => !o)}
                  >
                    <span className="font-medium">Advanced Config</span>
                    <span className="text-gray-500 text-xs">{configOpen ? '▲ hide' : '▼ show'}</span>
                  </button>

                  {configOpen && (
                    <div className="p-4 space-y-4">
                      {/* Hyperparameters grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <ConfigInput
                          label="Learning Rate" value={config.lr} type="number"
                          min={1e-6} max={0.1} step={1e-5} disabled={isTraining}
                          onChange={(v) => setConfigField('lr', parseFloat(v) || DEFAULT_TRAINING_CONFIG.lr)}
                        />
                        <ConfigInput
                          label="Batch Size" value={config.batch_size} type="number"
                          min={1} max={128} disabled={isTraining}
                          onChange={(v) => setConfigField('batch_size', parseInt(v) || DEFAULT_TRAINING_CONFIG.batch_size)}
                        />
                        <ConfigInput
                          label="Warmup Epochs" value={config.warmup_epochs} type="number"
                          min={0} max={100} disabled={isTraining}
                          onChange={(v) => setConfigField('warmup_epochs', parseInt(v) || 0)}
                        />
                        <ConfigInput
                          label="Grad Clip" value={config.grad_clip} type="number"
                          min={0} max={10} step={0.1} disabled={isTraining}
                          onChange={(v) => setConfigField('grad_clip', parseFloat(v) || DEFAULT_TRAINING_CONFIG.grad_clip)}
                        />
                        <ConfigInput
                          label="Early Stop Patience" value={config.early_stop_patience} type="number"
                          min={0} max={500} disabled={isTraining}
                          onChange={(v) => setConfigField('early_stop_patience', parseInt(v) || 0)}
                        />
                        <ConfigInput
                          label="Checkpoint Every N Epochs" value={config.checkpoint_every_n} type="number"
                          min={1} max={100} disabled={isTraining}
                          onChange={(v) => setConfigField('checkpoint_every_n', parseInt(v) || DEFAULT_TRAINING_CONFIG.checkpoint_every_n)}
                        />
                      </div>

                      {/* Augmentation toggles */}
                      <div>
                        <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Augmentation</p>
                        <div className="grid grid-cols-2 gap-2">
                          <AugToggle label="Channel Dropout" checked={config.aug_channel_dropout} disabled={isTraining}
                            onChange={(v) => setConfigField('aug_channel_dropout', v)} />
                          <AugToggle label="Gaussian Noise" checked={config.aug_gaussian_noise} disabled={isTraining}
                            onChange={(v) => setConfigField('aug_gaussian_noise', v)} />
                          <AugToggle label="Amplitude Scaling" checked={config.aug_amplitude_scaling} disabled={isTraining}
                            onChange={(v) => setConfigField('aug_amplitude_scaling', v)} />
                          <AugToggle label="Time Shift" checked={config.aug_time_shift} disabled={isTraining}
                            onChange={(v) => setConfigField('aug_time_shift', v)} />
                          <AugToggle label="Freq-Band Dropout" checked={config.aug_freq_band_dropout} disabled={isTraining}
                            onChange={(v) => setConfigField('aug_freq_band_dropout', v)} />
                        </div>
                      </div>

                      {/* Loss function */}
                      <div>
                        <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Loss Function</p>
                        <div className="space-y-2">
                          <AugToggle label="Focal Loss (γ — focuses on hard examples)" checked={config.use_focal_loss} disabled={isTraining}
                            onChange={(v) => setConfigField('use_focal_loss', v)} />
                          <div className="grid grid-cols-2 gap-3 mt-2">
                            <ConfigInput
                              label="Focal γ (0 = standard CE)" value={config.focal_gamma} type="number"
                              min={0} max={5} step={0.5} disabled={isTraining || !config.use_focal_loss}
                              onChange={(v) => setConfigField('focal_gamma', parseFloat(v) ?? DEFAULT_TRAINING_CONFIG.focal_gamma)}
                            />
                            <ConfigInput
                              label="Label Smoothing (0 = none)" value={config.label_smoothing} type="number"
                              min={0} max={0.5} step={0.05} disabled={isTraining}
                              onChange={(v) => setConfigField('label_smoothing', parseFloat(v) ?? DEFAULT_TRAINING_CONFIG.label_smoothing)}
                            />
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-gray-500">
                        Architecture: EEGConformer (EEGNet + SE attention + 4× Conformer, d_model=128) · Optimizer: AdamW + OneCycleLR
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress card */}
              {trainingStatus && trainingStatus.status !== 'idle' && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="font-semibold text-white">Progress</h2>
                    <span className={`text-sm font-medium ${statusColor[trainingStatus.status] ?? 'text-gray-400'}`}>
                      {statusLabel[trainingStatus.status] ?? trainingStatus.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                    <span>Epoch {trainingStatus.current_epoch} / {trainingStatus.total_epochs}</span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
                    <div className="bg-green-500 h-2 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">Train Loss</p>
                      <p className="text-white font-mono">{trainingStatus.loss.toFixed(4)}</p>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">Val Loss</p>
                      <p className={`font-mono ${trainingStatus.val_loss > 0 ? 'text-blue-300' : 'text-gray-500'}`}>
                        {trainingStatus.val_loss > 0 ? trainingStatus.val_loss.toFixed(4) : '—'}
                      </p>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">Accuracy</p>
                      <p className="text-white font-mono">{trainingStatus.accuracy.toFixed(1)}%</p>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-0.5">LR</p>
                      <p className="text-yellow-300 font-mono text-xs">{trainingStatus.lr ? trainingStatus.lr.toExponential(2) : '—'}</p>
                    </div>
                  </div>

                  {trainingStatus.best_val_loss != null && (
                    <p className="text-xs text-gray-400 mt-2">
                      Best val loss: <span className="text-green-400 font-mono">{trainingStatus.best_val_loss.toFixed(4)}</span>
                      {trainingStatus.best_epoch > 0 && <span> at epoch {trainingStatus.best_epoch}</span>}
                    </p>
                  )}

                  {trainingStatus.error && <p className="text-red-400 text-sm mt-3">{trainingStatus.error}</p>}
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
                          <th className="py-1 pr-4">Epoch</th>
                          <th className="py-1 pr-4">Train Loss</th>
                          <th className="py-1 pr-4">Val Loss</th>
                          <th className="py-1 pr-4">Accuracy</th>
                          <th className="py-1">LR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...trainingStatus.log].reverse().map((entry) => (
                          <tr key={entry.epoch} className="border-b border-gray-700/30 text-gray-300">
                            <td className="py-1 pr-4">{entry.epoch}</td>
                            <td className="py-1 pr-4 font-mono">{entry.loss.toFixed(4)}</td>
                            <td className="py-1 pr-4 font-mono text-blue-300">{entry.val_loss?.toFixed(4) ?? '—'}</td>
                            <td className="py-1 pr-4 font-mono">{entry.accuracy.toFixed(1)}%</td>
                            <td className="py-1 font-mono text-xs text-yellow-300">{entry.lr ? entry.lr.toExponential(2) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Model Info Tab ─────────────────────────────────────────────── */}
          <TabsContent value="model">
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-lg p-4">
                <h2 className="font-semibold text-white mb-4">Model Information</h2>
                {!trainingStatus ? (
                  <p className="text-gray-400 text-sm">Loading…</p>
                ) : !ckpt?.exists ? (
                  <div className="text-center py-10">
                    <p className="text-gray-400 mb-2">No trained model checkpoint found.</p>
                    <p className="text-gray-500 text-sm">Select sessions and start training to create one.</p>
                    <Button variant="outline" className="mt-4 border-gray-600 text-gray-300" onClick={() => setActiveTab('sessions')}>
                      Go to Sessions
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      <div className="bg-gray-700/50 rounded p-3">
                        <p className="text-gray-400 text-xs mb-0.5">Checkpoint</p>
                        <p className="text-green-400 font-medium">Loaded</p>
                      </div>
                      <div className="bg-gray-700/50 rounded p-3">
                        <p className="text-gray-400 text-xs mb-0.5">Best Epoch</p>
                        <p className="text-white font-mono">{trainingStatus.best_epoch > 0 ? trainingStatus.best_epoch : (ckpt.epoch ?? 0) + 1}</p>
                      </div>
                      <div className="bg-gray-700/50 rounded p-3">
                        <p className="text-gray-400 text-xs mb-0.5">Best Val Loss</p>
                        <p className="text-blue-300 font-mono">{ckpt.best_val_loss != null ? ckpt.best_val_loss.toFixed(4) : '—'}</p>
                      </div>
                      <div className="bg-gray-700/50 rounded p-3">
                        <p className="text-gray-400 text-xs mb-0.5">Vocabulary Size</p>
                        <p className="text-white font-mono">{ckpt.vocab_size}</p>
                      </div>
                      <div className="bg-gray-700/50 rounded p-3 col-span-2">
                        <p className="text-gray-400 text-xs mb-0.5">Architecture</p>
                        <p className="text-white text-xs">EEGConformer: EEGNet + 4× Conformer (d=128) · Hybrid CTC+CE · AdamW</p>
                      </div>
                    </div>

                    {ckpt.vocab && (
                      <div className="bg-gray-700/50 rounded p-3">
                        <p className="text-gray-400 text-xs mb-2">Vocabulary</p>
                        <div className="flex flex-wrap gap-1.5">
                          {ckpt.vocab.filter((w) => w !== '<blank>').map((w) => (
                            <span key={w} className="px-2 py-0.5 bg-gray-600 rounded text-xs text-white font-mono">{w}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Per-word accuracy */}
                    {trainingStatus.per_word_accuracy && Object.keys(trainingStatus.per_word_accuracy).length > 0 && (
                      <div className="bg-gray-700/50 rounded p-3">
                        <p className="text-gray-400 text-xs mb-2 font-medium uppercase tracking-wide">Per-Word Accuracy (last run)</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {Object.entries(trainingStatus.per_word_accuracy).map(([word, acc]) => (
                            <div key={word} className="flex items-center justify-between bg-gray-800 rounded px-3 py-1.5">
                              <span className="font-mono text-sm text-white">{word}</span>
                              <span className={`font-mono text-sm ${acc >= 70 ? 'text-green-400' : acc >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {acc.toFixed(0)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="bg-gray-700/50 rounded p-3">
                      <p className="text-gray-400 text-xs mb-1">
                        To run inference on a session, go to the{' '}
                        <button className="text-blue-400 underline" onClick={() => setActiveTab('sessions')}>Sessions tab</button>
                        {' '}and click <span className="text-blue-300">Predict</span>.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Checkpoint manager */}
              {trainingStatus && (trainingStatus.available_checkpoints?.length ?? 0) > 0 && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h2 className="font-semibold text-white mb-3">Checkpoint Manager</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-700 text-left">
                        <th className="py-2 pr-4">File</th>
                        <th className="py-2 pr-4">Epoch</th>
                        <th className="py-2 pr-4">Val Loss</th>
                        <th className="py-2 pr-4">Type</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(trainingStatus.available_checkpoints as CheckpointMeta[]).map((c) => (
                        <tr key={c.name} className="border-b border-gray-700/40 text-gray-300">
                          <td className="py-2 pr-4 font-mono text-xs">{c.name}</td>
                          <td className="py-2 pr-4 font-mono">{c.epoch + 1}</td>
                          <td className="py-2 pr-4 font-mono text-blue-300">{c.val_loss != null ? c.val_loss.toFixed(4) : '—'}</td>
                          <td className="py-2 pr-4">
                            {c.is_best
                              ? <span className="text-green-400 text-xs font-medium">Best</span>
                              : <span className="text-gray-500 text-xs">Periodic</span>}
                          </td>
                          <td className="py-2">
                            <Button
                              variant="outline" size="sm"
                              onClick={() => handleLoadCheckpoint(c.name)}
                              disabled={isTraining}
                              className="border-gray-600 text-gray-300 text-xs h-7 px-2"
                            >
                              Load
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Modals */}
      {playbackSessionId && <PlaybackModal sessionId={playbackSessionId} onClose={() => setPlaybackSessionId(null)} />}
      {predictionSessionId && <PredictionsModal sessionId={predictionSessionId} onClose={() => setPredictionSessionId(null)} />}
    </div>
  );
}
