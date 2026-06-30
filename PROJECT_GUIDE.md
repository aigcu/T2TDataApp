# T2TDataApp — Project Guide

A complete onboarding guide for the Thought-to-Text Brain-Computer Interface (BCI) application. Written for someone inheriting the project who needs to understand everything from scratch.

---

## Table of Contents

1. [What This Project Does](#1-what-this-project-does)
2. [Project Structure](#2-project-structure)
3. [How Data Collection Works](#3-how-data-collection-works)
4. [How the ML Model Works](#4-how-the-ml-model-works)
5. [How EEG Signals Become "Thought-to-Text"](#5-how-eeg-signals-become-thought-to-text)
6. [Using Your Laptop GPU](#6-using-your-laptop-gpu)
7. [How to Improve Moving Forward](#7-how-to-improve-moving-forward)
8. [Glossary](#8-glossary)

---

## 1. What This Project Does

This application records **EEG (brain signals)** while a person imagines speaking specific words, then trains a deep learning model to recognize which word was imagined purely from the brain signal — no speaking required.

The end goal is **thought-to-text**: a system that reads what your brain intends to say before you say it. This is especially valuable for people with paralysis, ALS, or locked-in syndrome.

### The Core Loop

```
Person imagines a word
       ↓
EEG headset records their brain activity (16 channels, 125 Hz)
       ↓
App saves those signals aligned to which word was shown
       ↓
ML model trains on those labeled brain signals
       ↓
Model learns to classify: "this pattern of brain activity = WATER"
       ↓
In real use: person thinks → model predicts → text appears
```

### Current Vocabulary (10 words)

| ID | Word   | ID | Word  |
|----|--------|----|-------|
| 1  | YES    | 6  | WATER |
| 2  | NO     | 7  | FOOD  |
| 3  | HELP   | 8  | PAIN  |
| 4  | STOP   | 9  | MORE  |
| 5  | GO     | 10 | NEED  |

These words are intentionally chosen to be useful for basic communication (e.g., medical/assistive contexts).

---

## 2. Project Structure

```
T2TDataApp/
├── backend/                   ← Python server (FastAPI + ML)
│   ├── main.py                ← REST API entry point
│   ├── model.py               ← Neural network architecture + datasets
│   ├── models.py              ← Data shape definitions (Pydantic)
│   ├── constants.py           ← Word list, timing settings
│   ├── socket_handlers.py     ← Real-time WebSocket events
│   ├── services/
│   │   ├── eeg_service.py     ← Talks to the OpenBCI headset
│   │   ├── session_service.py ← Manages one recording session
│   │   ├── csv_service.py     ← Writes brain data to CSV files
│   │   └── training_service.py← Runs the training loop
│   ├── data/sessions/         ← Saved CSV files (your training data)
│   ├── model_best.pth         ← Best model checkpoint saved so far
│   ├── model_latest.pth       ← Most recent model checkpoint
│   └── requirements.txt       ← Python packages needed
│
├── Frontend/                  ← React web app (TypeScript)
│   ├── src/
│   │   ├── App.tsx            ← Main screen-flow controller
│   │   ├── components/        ← UI screens and widgets
│   │   │   ├── IntakeForm.tsx      ← Participant sign-up form
│   │   │   ├── ReadyScreen.tsx     ← Pre-session checklist
│   │   │   ├── ColorPresentation.tsx ← Word display during session
│   │   │   ├── SummaryScreen.tsx   ← Post-session stats
│   │   │   └── ModelDashboard.tsx  ← Training dashboard
│   │   ├── hooks/             ← Reusable logic
│   │   │   ├── useSocketIO.ts      ← WebSocket connection
│   │   │   └── useColorSequence.ts ← Word timing logic
│   │   └── contexts/          ← Global app state
│   └── package.json           ← Node packages needed
│
├── docker-compose.yml         ← Runs both frontend + backend together
└── PROJECT_GUIDE.md           ← This file
```

### Backend vs Frontend — Simple Explanation

| Layer    | Technology | Responsibility |
|----------|------------|----------------|
| Frontend | React + TypeScript | What the user sees: forms, word display, training dashboard |
| Backend  | Python + FastAPI | EEG hardware, data storage, ML training, REST API |
| Bridge   | Socket.IO (WebSocket) | Real-time events between frontend ↔ backend |

---

## 3. How Data Collection Works

### Step 1 — Participant Registration

The `IntakeForm` screen collects basic demographics (name, age, sex, gender, race) and how many trials to run. This info is saved in the CSV metadata so you know who recorded each session.

### Step 2 — EEG Connection

`eeg_service.py` connects to an **OpenBCI Cyton+Daisy** headset via USB. This headset has 16 electrodes that measure tiny electrical voltage changes on the scalp. It samples at **125 Hz** — meaning 125 readings per second across all 16 channels.

### Step 3 — The Recording Session

The `ColorPresentation` screen shows words one at a time:
- A word appears on screen for **5 seconds** → participant imagines saying it
- A rest period of **2 seconds** → brain "resets"
- Repeated for all 10 words × number of trials

While this is happening:
- `session_service.py` logs `word_start` and `word_end` events with precise timestamps
- `eeg_service.py` continuously streams EEG data
- `csv_service.py` writes everything to a CSV file in real-time (thread-safe)

### Step 4 — The CSV Output

Each session produces a file like `session_20250101_100000_John.csv`:

```
# Header (metadata)
session_id,20250101_100000
participant_name,John
eeg_sample_rate_hz,125
eeg_channels,16
word_duration_ms,5000
...

# Data rows
event,word,word_id,trial,timestamp,relative_time_ms,ch1,ch2,...,ch16
word_start,YES,0,1,2025-01-01T10:00:00Z,0,,,,
eeg_sample,,,1,,8,12.5,13.2,...,11.8     ← 8ms after start
eeg_sample,,,1,,16,12.6,13.3,...,11.9    ← 16ms after start
...625 more rows...
word_end,YES,0,1,2025-01-01T10:00:05Z,5000,,,,
rest_start,,,,...
rest_end,,,,...
```

Each `word_start → word_end` block contains ~625 EEG samples (5 seconds × 125 Hz). This is one **labeled training window** for the model: "this brain activity = thinking of YES."

---

## 4. How the ML Model Works

### The Big Picture

The model is called **EEGConformer**. It takes a 2-second slice of EEG as input and outputs which of the 10 words was being imagined.

Input shape: `(batch_size, 16 channels, 256 time_samples)`
Output shape: `(batch_size, 11 classes)` — 11 because index 0 is `<blank>` (padding)

### Architecture Walkthrough

Think of it as a pipeline with four stages:

```
Stage 1: CNN Feature Extractor (EEGNetFeatureExtractor)
  - Learns local patterns in time and space
  - Learns which electrode combinations matter

Stage 2: Projection
  - Reshapes CNN output to work with attention

Stage 3: Conformer Blocks × 4
  - Combines Transformer attention + local convolution
  - Captures both global context and local structure

Stage 4: Classification Head
  - Takes the compressed representation → outputs 11 class scores
```

#### Stage 1 — CNN Feature Extractor

Inspired by **EEGNet**, a well-known EEG deep learning architecture:

| Layer | What it does |
|-------|-------------|
| Temporal Conv (kernel=64) | Detects patterns happening over ~512ms windows |
| Depthwise Conv | Learns which electrode (channel) is most informative |
| Squeeze-Excitation | Automatically weights important channels higher |
| Separable Conv | Learns channel combinations efficiently |

Output: 32 temporal frames, each with 16 features.

#### Stage 2 — Conformer Blocks

**Transformers** (like the "T" in ChatGPT) use **self-attention**: every time-step looks at every other time-step and figures out which moments in the signal relate to each other. This is powerful for sequence data.

**Conformers** add **local convolution** inside each Transformer block. This matters for EEG because brain signals have both:
- Long-range dependencies (e.g., activity 1 second ago matters now)
- Local structure (e.g., a spike or oscillation within 50ms)

4 stacked Conformer blocks progressively build a richer representation.

#### Stage 3 — Mean Pooling + Classification

After 4 Conformer blocks, the model has a sequence of 32 feature vectors. It averages them (mean pool) into one 128-dim vector representing the entire window, then projects it to 11 class scores.

### Loss Function — Focal Loss

Normal cross-entropy loss treats every mistake equally. **Focal Loss** (γ=2.0) focuses more on the hard, uncertain examples and less on the easy ones. This helps when some word pairs are hard to distinguish (e.g., imagining YES vs. NO might look similar in the EEG).

**Label smoothing** (ε=0.1) prevents the model from becoming overconfident — instead of targeting 100% probability for the correct class, it targets 90%.

### Data Preprocessing

Before the model ever sees data, the raw EEG goes through:

| Step | Why |
|------|-----|
| Common Average Reference (CAR) | Removes noise common across all electrodes |
| Bandpass 0.5–40 Hz | Keeps brain rhythms, removes drift and high-freq noise |
| Notch filter 60 Hz | Removes US power line interference |
| Artifact rejection (±100 µV threshold) | Discards windows with muscle/eye movements |
| Resample to 256 samples | Standardizes all windows to the same length |

### Data Augmentation

Because EEG datasets are small (collecting real brain data is slow), the model artificially varies each training sample to prevent overfitting:

| Augmentation | Effect |
|---|---|
| Channel dropout | Randomly zeros 10% of channels → model can't rely on one electrode |
| Gaussian noise (2% RMS) | Adds realistic measurement noise |
| Amplitude scaling (±15%) | Handles natural variation in signal strength |
| Time shift (±15%) | Simulates slight timing differences |
| Frequency-band dropout | Zeroes random theta/alpha/beta bands in frequency space |

### Training Loop

```
For each epoch:
  1. Load batch of (EEG_window, word_label)
  2. Apply augmentation
  3. Forward pass through EEGConformer → logits
  4. Compute Focal Loss
  5. Backward pass (compute gradients)
  6. Clip gradients (max norm 1.0) to prevent instability
  7. AdamW optimizer step (update weights)
  8. OneCycleLR scheduler step (adjust learning rate)

After each epoch:
  - Evaluate on 20% validation set
  - Save best checkpoint if val_loss improved
  - Save epoch checkpoint every N epochs
  - Check early stopping (stop if no improvement for 25 epochs)
```

**AdamW** is the standard modern optimizer. **OneCycleLR** ramps the learning rate up then back down over training, which typically finds better minima.

---

## 5. How EEG Signals Become "Thought-to-Text"

This is the core science. Here's what's actually happening in the brain and why the model can (eventually) learn to decode it.

### What EEG Measures

EEG electrodes on the scalp pick up tiny electrical signals produced by synchronized firing of thousands of neurons. Different mental activities produce distinct patterns:

| Brain Activity | EEG Pattern |
|---|---|
| Eyes closed / relaxed | Alpha waves (8–12 Hz) |
| Active thinking | Beta waves (13–30 Hz) |
| Deep focus / motor imagery | Gamma waves (30+ Hz) |
| Memory / imagery | Theta waves (4–8 Hz) |

### Imagined Speech vs. Actual Speech

When you **speak** a word, the motor cortex fires to control your mouth muscles. When you **imagine** speaking the same word, a weaker but measurably different version of those same motor cortex patterns activates — without moving your mouth.

This phenomenon is called **motor imagery for speech** and is the scientific foundation of this project. The hypothesis: each word produces a slightly different imagined-speech motor pattern, and the model can learn to distinguish them.

### Why It's Hard

1. **Signal-to-noise ratio is terrible** — skull, scalp, and hair all attenuate the signal
2. **Inter-subject variability** — YOUR brain's pattern for "WATER" is different from mine
3. **Temporal variation** — even your own pattern changes between sessions
4. **Small datasets** — collecting labeled EEG is slow; other ML domains have millions of examples
5. **10-way classification** — harder than binary yes/no BCI systems

### The Training → Inference Pipeline

**Training time:**
1. Collect N sessions with the participant imagining words on cue
2. Each labeled window (16 ch × 256 samples) paired with the correct word ID
3. Model trains to minimize Focal Loss on these pairs
4. After enough data, model weights encode: "this brain pattern → this word"

**Inference time (future real use):**
1. Person thinks of a word
2. 2-second EEG window is captured
3. Preprocessing (CAR, bandpass, notch)
4. Model forward pass → 11 logit scores
5. Softmax → probabilities
6. Argmax → predicted word (e.g., "WATER: 73%")
7. Text displayed

### Current Limitation: Per-Subject Training

The current model trains on whoever's data you give it. It doesn't generalize across people automatically. For real use, you'd need to either:
- Collect many sessions from one user and train their personal model
- Or eventually collect data from many users and train a generalized model (much harder)

---

## 6. Using Your Laptop GPU

Training on CPU is slow. If your laptop has a GPU, you can speed up training by 5–50×.

### Step 1 — Identify Your GPU

Open Command Prompt and run:
```
dxdiag
```
Or in PowerShell:
```powershell
Get-WmiObject Win32_VideoController | Select-Object Name
```

### Step 2A — If You Have an NVIDIA GPU (GeForce RTX/GTX)

This is the best case. Install **CUDA** and **cuDNN**:

1. Check your driver version: `nvidia-smi` in terminal
2. Install the matching PyTorch with CUDA from [pytorch.org](https://pytorch.org/get-started/locally/):
   ```bash
   pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
   ```
   (Replace `cu121` with your CUDA version, e.g. `cu118` for CUDA 11.8)

3. Verify it works:
   ```python
   import torch
   print(torch.cuda.is_available())       # Should print True
   print(torch.cuda.get_device_name(0))   # Should print your GPU name
   ```

### Step 2B — If You Have an AMD GPU

AMD on Windows uses **DirectML**:
```bash
pip install torch-directml
```
Then in your code use `device = torch_directml.device()` instead of `cuda`.

### Step 2C — If You Only Have Intel Integrated Graphics

Intel Arc GPUs support Intel Extension for PyTorch (IPEX):
```bash
pip install intel-extension-for-pytorch
```

### Step 3 — Make the Code Use Your GPU

The model already has device-aware code. Check [backend/services/training_service.py](backend/services/training_service.py) for where the device is set. It should look like:

```python
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = model.to(device)
```

If you don't see this, find where the model is instantiated and add `.to(device)`, and ensure all input tensors also get `.to(device)` in the training loop.

### Step 4 — Enable Mixed Precision (Free Speed Boost)

If you have an NVIDIA GPU, add **AMP (Automatic Mixed Precision)** to the training loop in [backend/services/training_service.py](backend/services/training_service.py):

```python
from torch.cuda.amp import GradScaler, autocast

scaler = GradScaler()

# Inside training loop:
with autocast():
    output = model(inputs)
    loss = criterion(output, labels)

scaler.scale(loss).backward()
scaler.step(optimizer)
scaler.update()
```

This uses float16 where safe (roughly 2× faster, uses less VRAM) while keeping float32 where precision matters.

### Expected Speed Improvement

| Hardware | Approx. Training Speed |
|---|---|
| CPU only (current) | Baseline (1×) |
| Entry laptop GPU (GTX 1650) | ~5–8× faster |
| Mid-range laptop GPU (RTX 3060) | ~15–25× faster |
| High-end laptop GPU (RTX 4080) | ~30–50× faster |

---

## 7. How to Improve Moving Forward

These are ordered roughly from easiest to hardest.

### Tier 1 — Low Effort, High Impact

#### 1.1 Collect More Data
The single biggest improvement you can make. More labeled EEG sessions = better model. Aim for:
- At least 10 sessions per participant
- Multiple participants if possible
- Consistent environment (same room, time of day, noise level)

#### 1.2 Add GPU Training (see Section 6)
Will dramatically reduce training time, letting you run more experiments.

#### 1.3 Tune Hyperparameters
The training dashboard lets you configure these. Try:
- Lower learning rate (e.g., `1e-4` instead of `2e-4`) with more data
- Larger batch size (e.g., 16 or 32) once you have more data
- Longer patience (e.g., 40) to avoid stopping too early

#### 1.4 Track Per-Word Accuracy
Already built into the model. Use this to identify which words are hardest to classify. If "YES" and "NO" are consistently confused, that tells you something about the data collection protocol.

---

### Tier 2 — Moderate Effort

#### 2.1 Add Cross-Validation
Instead of a single 80/20 split, use **k-fold cross-validation** (e.g., k=5). This gives a more reliable estimate of true model performance and reduces the chance of getting lucky/unlucky with one split.

In [backend/services/training_service.py](backend/services/training_service.py), replace the single split with a `KFold` loop from `sklearn.model_selection`.

#### 2.2 Add Subject-Specific Fine-Tuning
Train a general model on all participants, then fine-tune a few layers on new user's data for 10–20 epochs. This is called **transfer learning** and works well for EEG where inter-subject differences are large.

#### 2.3 Better Artifact Rejection
The current ±100 µV threshold is a blunt instrument. Add:
- **ICA (Independent Component Analysis)** to separate eye blinks, muscle noise from brain signal — `mne` library handles this
- **Epoch variance threshold** (reject if std dev > threshold)

#### 2.4 Feature Engineering Baseline
Add a classical ML baseline alongside the deep model:
- Extract band power features (delta, theta, alpha, beta, gamma) per channel per window
- Feed into a Random Forest or SVM classifier
- If the simple model does as well as the neural net, you probably don't have enough data for deep learning yet

---

### Tier 3 — Significant Effort

#### 3.1 Real-Time Inference
The current system runs inference after a session ends. Add a **real-time prediction loop** in `eeg_service.py`:
1. Maintain a rolling 2-second buffer
2. Every 500ms, preprocess and run model inference on the buffer
3. Push predicted word to frontend via Socket.IO
4. Apply a confidence threshold (only display if confidence > 70%)

#### 3.2 Add More Subjects / Data Sharing
Build a system to collect data from multiple participants and train a shared model. Key additions:
- Subject ID in the CSV metadata (already partially there)
- Subject normalization layer in the model (e.g., per-subject batch norm)
- A "public sessions" upload mechanism (privacy considerations apply)

#### 3.3 Switch to MNE for Preprocessing
The current preprocessing uses raw `scipy`. **MNE-Python** is the standard EEG analysis library and provides:
- Better artifact detection (ICA, EOG/EMG regression)
- Proper epoching and baseline correction
- Spectral analysis tools
- Compatibility with standard EEG datasets for benchmarking

```bash
pip install mne
```

#### 3.4 Expand the Vocabulary
Currently 10 words. To expand:
1. Add new words to `constants.py` (backend) and matching frontend constants
2. Update model output size: `nn.Linear(128, len(WORDS) + 1)` in [backend/model.py](backend/model.py)
3. Retrain from scratch — existing checkpoints won't be compatible with a different output size

#### 3.5 Implement CTC for Continuous Decoding
For full thought-to-text (not just one word at a time), you'd need **CTC (Connectionist Temporal Classification)** or a sequence-to-sequence model. This is a research-level challenge but is the long-term goal of the field.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **EEG** | Electroencephalography — measuring electrical brain activity via scalp electrodes |
| **BCI** | Brain-Computer Interface — a system that translates brain signals into computer commands |
| **Hz** | Hertz — samples per second. 125 Hz = 125 readings per second |
| **Channel** | One electrode on the EEG headset. This system uses 16 channels (electrodes) |
| **Epoch/Window** | A fixed-length slice of EEG corresponding to one stimulus (one word trial) |
| **CAR** | Common Average Reference — subtract mean of all channels to reduce noise common to all |
| **Bandpass filter** | Keeps only frequencies within a range (e.g., 0.5–40 Hz); removes everything outside |
| **Notch filter** | Removes one specific frequency (60 Hz power line interference) |
| **Artifact** | Noise in the EEG from non-brain sources: eye blinks, muscle movement, power line |
| **Conformer** | A neural network combining Transformer self-attention with local convolution |
| **Focal Loss** | A loss function that focuses training on hard, uncertain examples |
| **AMP** | Automatic Mixed Precision — uses float16 for speed, float32 where needed |
| **AdamW** | A modern gradient descent optimizer with weight decay regularization |
| **OneCycleLR** | A learning rate schedule that ramps up then down during training |
| **Early Stopping** | Halt training if validation loss stops improving (prevents overfitting) |
| **Overfitting** | Model memorizes training data but fails on new data |
| **Transfer Learning** | Using a model trained on one dataset as a starting point for another |
| **ICA** | Independent Component Analysis — separates mixed signals into independent sources |
| **CTC** | Connectionist Temporal Classification — a loss function for sequence-to-sequence tasks |
| **Motor imagery** | Imagining a physical movement without performing it; activates similar brain regions |
| **pth file** | PyTorch checkpoint file — a saved snapshot of model weights |
| **Socket.IO** | A library for real-time bidirectional events between browser and server |

---

*Last updated: 2026-05-04*
