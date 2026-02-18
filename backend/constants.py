"""
BCI Data Collection - Constants
Color definitions and timing configurations for the stimulus protocol.
"""

from typing import TypedDict


class ColorDefinition(TypedDict):
    id: int
    name: str
    hex: str
    text_color: str  # For contrast when displaying color name


# 7 Training Colors shown in order
COLORS: list[ColorDefinition] = [
    {"id": 0, "name": "RED", "hex": "#FF0000", "text_color": "#FFFFFF"},
    {"id": 1, "name": "BLUE", "hex": "#0000FF", "text_color": "#FFFFFF"},
    {"id": 2, "name": "GREEN", "hex": "#00FF00", "text_color": "#000000"},
    {"id": 3, "name": "PINK", "hex": "#FF69B4", "text_color": "#000000"},
    {"id": 4, "name": "YELLOW", "hex": "#FFFF00", "text_color": "#000000"},
    {"id": 5, "name": "ORANGE", "hex": "#FFA500", "text_color": "#000000"},
    {"id": 6, "name": "BLACK", "hex": "#000000", "text_color": "#FFFFFF"},
]

# Timing constants (in milliseconds)
COLOR_DURATION_MS = 5000  # 5 seconds per color
REST_DURATION_MS = 2000   # 2 seconds rest between colors
COUNTDOWN_DURATION_S = 3  # 3 second countdown

# Derived constants
COLORS_PER_TRIAL = len(COLORS)  # 7 colors
TRIAL_DURATION_MS = (COLOR_DURATION_MS + REST_DURATION_MS) * COLORS_PER_TRIAL  # 49 seconds

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
