"""
BCI Data Collection - Constants
Word definitions and timing configurations for the stimulus protocol.
"""

from typing import TypedDict


class WordDefinition(TypedDict):
    id: int
    name: str


# 10 Training Words shown in order
WORDS: list[WordDefinition] = [
    {"id": 0, "name": "YES"},
    {"id": 1, "name": "NO"},
    {"id": 2, "name": "HELP"},
    {"id": 3, "name": "STOP"},
    {"id": 4, "name": "GO"},
    {"id": 5, "name": "WATER"},
    {"id": 6, "name": "FOOD"},
    {"id": 7, "name": "PAIN"},
    {"id": 8, "name": "MORE"},
    {"id": 9, "name": "NEED"},
]

# Timing constants (in milliseconds)
WORD_DURATION_MS = 5000   # 5 seconds per word
REST_DURATION_MS = 2000   # 2 seconds rest between words
COUNTDOWN_DURATION_S = 3  # 3 second countdown

# Derived constants
WORDS_PER_TRIAL = len(WORDS)  # 10 words
TRIAL_DURATION_MS = (WORD_DURATION_MS + REST_DURATION_MS) * WORDS_PER_TRIAL  # 70 seconds

# Trial count options with calculated durations
TRIAL_OPTIONS = [
    {"trials": 5, "duration_min": round(5 * TRIAL_DURATION_MS / 60000)},
    {"trials": 10, "duration_min": round(10 * TRIAL_DURATION_MS / 60000)},
    {"trials": 25, "duration_min": round(25 * TRIAL_DURATION_MS / 60000)},
    {"trials": 50, "duration_min": round(50 * TRIAL_DURATION_MS / 60000)},
    {"trials": 100, "duration_min": round(100 * TRIAL_DURATION_MS / 60000)},
]

# Sex options
SEX_OPTIONS = ["Male", "Female", "Other", "Prefer not to say"]

# Race options
RACE_OPTIONS = [
    "White",
    "Black/African American",
    "Asian",
    "Hispanic/Latino",
    "Native American",
    "Pacific Islander",
    "Two or more",
    "Other",
    "Prefer not to say",
]

# Data directory
DATA_DIR = "data/sessions"
