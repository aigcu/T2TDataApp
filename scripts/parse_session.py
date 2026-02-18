#!/usr/bin/env python3
"""
EEG Session Data Parser - Verify data integrity and detect sample loss.

Usage:
    python scripts/parse_session.py <session_file.csv>
    python scripts/parse_session.py backend/data/sessions/  # Parse all sessions
"""

import argparse
import csv
from pathlib import Path
from statistics import mean, stdev
from typing import NamedTuple


class SessionMetadata(NamedTuple):
    session_id: str
    participant_name: str
    participant_age: int
    total_trials: int
    color_duration_ms: int
    rest_duration_ms: int
    eeg_enabled: bool
    eeg_sample_rate_hz: int
    eeg_channels: int
    start_time: str
    end_time: str


class EEGSample(NamedTuple):
    relative_time_ms: int
    channels: list[float]


class Event(NamedTuple):
    event_type: str
    color: str
    color_id: str
    trial: int
    timestamp: str
    relative_time_ms: int


def parse_metadata(lines: list[str]) -> SessionMetadata:
    """Parse the metadata section (first 15 lines) of the CSV."""
    meta = {}
    for line in lines[:15]:
        if ',' in line:
            key, value = line.split(',', 1)
            meta[key.strip()] = value.strip()

    return SessionMetadata(
        session_id=meta.get('session_id', ''),
        participant_name=meta.get('participant_name', ''),
        participant_age=int(meta.get('participant_age', 0)),
        total_trials=int(meta.get('total_trials', 0)),
        color_duration_ms=int(meta.get('color_duration_ms', 5000)),
        rest_duration_ms=int(meta.get('rest_duration_ms', 2000)),
        eeg_enabled=meta.get('eeg_enabled', 'false').lower() == 'true',
        eeg_sample_rate_hz=int(meta.get('eeg_sample_rate_hz', 125)),
        eeg_channels=int(meta.get('eeg_channels', 16)),
        start_time=meta.get('start_time', ''),
        end_time=meta.get('end_time', ''),
    )


def parse_session_file(filepath: Path) -> tuple[SessionMetadata, list[EEGSample], list[Event]]:
    """Parse a session CSV file and return metadata, EEG samples, and events."""
    with open(filepath, 'r') as f:
        content = f.read()

    lines = content.strip().split('\n')
    metadata = parse_metadata(lines)

    eeg_samples = []
    events = []

    # Find the header row (line 17, index 16)
    data_start = 17
    for i, line in enumerate(lines[data_start:], start=data_start):
        if not line.strip():
            continue

        parts = line.split(',')
        if len(parts) < 6:
            continue

        event_type = parts[0]

        if event_type == 'eeg_sample':
            try:
                relative_time = int(parts[5]) if parts[5] else 0
                channels = []
                for ch in parts[6:22]:
                    channels.append(float(ch) if ch else 0.0)
                eeg_samples.append(EEGSample(relative_time, channels))
            except (ValueError, IndexError):
                continue
        elif event_type in ('session_start', 'session_end', 'color_start',
                            'color_end', 'rest_start', 'rest_end'):
            try:
                trial = int(parts[3]) if parts[3] else 0
                relative_time = int(parts[5]) if parts[5] else 0
                events.append(Event(
                    event_type=event_type,
                    color=parts[1],
                    color_id=parts[2],
                    trial=trial,
                    timestamp=parts[4],
                    relative_time_ms=relative_time,
                ))
            except (ValueError, IndexError):
                continue

    return metadata, eeg_samples, events


def analyze_sample_rate(metadata: SessionMetadata, samples: list[EEGSample]) -> dict:
    """Analyze the actual sample rate vs expected."""
    if not samples:
        return {'actual_rate': 0, 'expected_rate': 0, 'data_loss_pct': 100}

    first_time = samples[0].relative_time_ms
    last_time = samples[-1].relative_time_ms
    duration_sec = (last_time - first_time) / 1000

    if duration_sec <= 0:
        return {'actual_rate': 0, 'expected_rate': metadata.eeg_sample_rate_hz, 'data_loss_pct': 100}

    actual_rate = len(samples) / duration_sec
    expected_rate = metadata.eeg_sample_rate_hz
    expected_samples = int(duration_sec * expected_rate)
    data_loss_pct = max(0, (1 - len(samples) / expected_samples) * 100)

    return {
        'actual_rate': actual_rate,
        'expected_rate': expected_rate,
        'actual_samples': len(samples),
        'expected_samples': expected_samples,
        'duration_sec': duration_sec,
        'data_loss_pct': data_loss_pct,
    }


def analyze_gaps(samples: list[EEGSample], expected_interval_ms: float = 8.0) -> dict:
    """Detect gaps in the EEG data stream."""
    if len(samples) < 2:
        return {'gaps': [], 'largest_gap': 0, 'avg_interval': 0}

    intervals = []
    gaps = []
    threshold = expected_interval_ms * 2  # Gap if > 2x expected interval

    for i in range(1, len(samples)):
        interval = samples[i].relative_time_ms - samples[i-1].relative_time_ms
        intervals.append(interval)
        if interval > threshold:
            gaps.append({
                'at_time_ms': samples[i-1].relative_time_ms,
                'gap_ms': interval,
                'expected_samples_lost': int(interval / expected_interval_ms) - 1,
            })

    return {
        'total_gaps': len(gaps),
        'gaps': gaps[:10],  # First 10 gaps
        'largest_gap_ms': max(intervals) if intervals else 0,
        'avg_interval_ms': mean(intervals) if intervals else 0,
        'interval_stdev_ms': stdev(intervals) if len(intervals) > 1 else 0,
    }


def analyze_channels(samples: list[EEGSample], num_channels: int = 16) -> list[dict]:
    """Analyze each EEG channel for data quality."""
    if not samples:
        return []

    channel_stats = []
    for ch_idx in range(num_channels):
        values = [s.channels[ch_idx] for s in samples if len(s.channels) > ch_idx]
        if not values:
            channel_stats.append({'channel': ch_idx + 1, 'error': 'no data'})
            continue

        zero_count = sum(1 for v in values if v == 0.0)
        zero_pct = (zero_count / len(values)) * 100

        channel_stats.append({
            'channel': ch_idx + 1,
            'min': min(values),
            'max': max(values),
            'mean': mean(values),
            'zero_pct': zero_pct,
            'samples': len(values),
        })

    return channel_stats


def analyze_per_trial(metadata: SessionMetadata, samples: list[EEGSample],
                      events: list[Event]) -> list[dict]:
    """Analyze EEG samples per trial period."""
    if not samples or not events:
        return []

    trials = []
    trial_events = [e for e in events if e.event_type == 'color_start']

    # Group by trial number
    trial_numbers = sorted(set(e.trial for e in trial_events if e.trial > 0))

    for trial_num in trial_numbers:
        # Find trial start and end times
        trial_starts = [e for e in events if e.trial == trial_num and e.event_type == 'color_start']
        trial_ends = [e for e in events if e.trial == trial_num and e.event_type == 'rest_end']

        if not trial_starts or not trial_ends:
            continue

        start_time = min(e.relative_time_ms for e in trial_starts)
        end_time = max(e.relative_time_ms for e in trial_ends)

        trial_samples = [s for s in samples
                        if start_time <= s.relative_time_ms <= end_time]

        duration_sec = (end_time - start_time) / 1000
        expected_samples = int(duration_sec * metadata.eeg_sample_rate_hz)

        trials.append({
            'trial': trial_num,
            'start_ms': start_time,
            'end_ms': end_time,
            'duration_sec': duration_sec,
            'actual_samples': len(trial_samples),
            'expected_samples': expected_samples,
            'capture_rate_pct': (len(trial_samples) / expected_samples * 100) if expected_samples > 0 else 0,
        })

    return trials


def print_report(filepath: Path, metadata: SessionMetadata, samples: list[EEGSample],
                 events: list[Event]):
    """Print a comprehensive EEG data integrity report."""
    print("\n" + "=" * 60)
    print("EEG DATA INTEGRITY REPORT")
    print("=" * 60)

    print(f"\nSession: {metadata.session_id}")
    print(f"Participant: {metadata.participant_name} (Age: {metadata.participant_age})")
    print(f"File: {filepath.name}")
    print(f"EEG Enabled: {metadata.eeg_enabled}")

    if not metadata.eeg_enabled:
        print("\n[!] EEG was not enabled for this session")
        return

    if not samples:
        print("\n[!] No EEG samples found in this session")
        return

    # Sample Rate Analysis
    rate_analysis = analyze_sample_rate(metadata, samples)
    print("\n" + "-" * 40)
    print("SAMPLE RATE ANALYSIS")
    print("-" * 40)
    print(f"Duration: {rate_analysis['duration_sec']:.1f} seconds")
    print(f"Expected rate: {rate_analysis['expected_rate']} Hz")
    print(f"Actual rate: {rate_analysis['actual_rate']:.1f} Hz")
    print(f"Expected samples: {rate_analysis['expected_samples']:,}")
    print(f"Actual samples: {rate_analysis['actual_samples']:,}")

    loss = rate_analysis['data_loss_pct']
    if loss > 50:
        print(f"DATA LOSS: {loss:.1f}% [CRITICAL]")
    elif loss > 20:
        print(f"DATA LOSS: {loss:.1f}% [WARNING]")
    elif loss > 5:
        print(f"DATA LOSS: {loss:.1f}% [MINOR]")
    else:
        print(f"Data loss: {loss:.1f}% [OK]")

    # Gap Analysis
    gap_analysis = analyze_gaps(samples, 1000 / metadata.eeg_sample_rate_hz)
    print("\n" + "-" * 40)
    print("GAP ANALYSIS")
    print("-" * 40)
    print(f"Expected interval: {1000 / metadata.eeg_sample_rate_hz:.1f}ms")
    print(f"Average interval: {gap_analysis['avg_interval_ms']:.1f}ms")
    print(f"Interval std dev: {gap_analysis['interval_stdev_ms']:.1f}ms")
    print(f"Largest gap: {gap_analysis['largest_gap_ms']}ms")
    print(f"Gaps detected (>2x expected): {gap_analysis['total_gaps']}")

    if gap_analysis['gaps']:
        print("\nFirst few gaps:")
        for gap in gap_analysis['gaps'][:5]:
            print(f"  - {gap['gap_ms']}ms gap at {gap['at_time_ms']}ms "
                  f"(~{gap['expected_samples_lost']} samples lost)")

    # Per-Trial Analysis
    trial_analysis = analyze_per_trial(metadata, samples, events)
    if trial_analysis:
        print("\n" + "-" * 40)
        print("PER-TRIAL BREAKDOWN")
        print("-" * 40)
        for trial in trial_analysis:
            status = "[OK]" if trial['capture_rate_pct'] > 90 else "[LOW]"
            print(f"Trial {trial['trial']}: {trial['actual_samples']:,}/{trial['expected_samples']:,} "
                  f"samples ({trial['capture_rate_pct']:.1f}%) {status}")

    # Channel Analysis
    channel_analysis = analyze_channels(samples, metadata.eeg_channels)
    print("\n" + "-" * 40)
    print("CHANNEL HEALTH")
    print("-" * 40)

    for ch in channel_analysis:
        if 'error' in ch:
            print(f"ch{ch['channel']}: {ch['error']}")
        else:
            zero_status = "[WARNING: high zeros]" if ch['zero_pct'] > 10 else ""
            print(f"ch{ch['channel']:2d}: range=[{ch['min']:.0f}, {ch['max']:.0f}], "
                  f"mean={ch['mean']:.0f}, zeros={ch['zero_pct']:.1f}% {zero_status}")

    # Event Summary
    print("\n" + "-" * 40)
    print("EVENT SUMMARY")
    print("-" * 40)
    event_counts = {}
    for e in events:
        event_counts[e.event_type] = event_counts.get(e.event_type, 0) + 1
    for event_type, count in sorted(event_counts.items()):
        print(f"  {event_type}: {count}")

    print("\n" + "=" * 60)


def main():
    parser = argparse.ArgumentParser(description='Parse and verify EEG session data')
    parser.add_argument('path', type=str, help='Session CSV file or directory')
    args = parser.parse_args()

    path = Path(args.path)

    if path.is_file():
        files = [path]
    elif path.is_dir():
        files = sorted(path.glob('session_*.csv'))
    else:
        print(f"Error: {path} not found")
        return 1

    if not files:
        print(f"No session files found in {path}")
        return 1

    for filepath in files:
        try:
            metadata, samples, events = parse_session_file(filepath)
            print_report(filepath, metadata, samples, events)
        except Exception as e:
            print(f"Error parsing {filepath}: {e}")
            continue

    return 0


if __name__ == '__main__':
    exit(main())
