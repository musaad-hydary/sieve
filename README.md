# Sieve

Chrome MV3 extension for live chord detection from any browser tab. Captures tab audio, runs pitch-class analysis, and displays chords, key, and progression in a side panel.

## Install

1. Clone or download this repo
2. Open `chrome://extensions` and enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Set site access to **On all sites** (extension settings -> Site access) for one-click capture without re-clicking the icon each time

## Usage

Open a tab playing audio (YouTube, Spotify Web, SoundCloud, etc.), then click the Sieve toolbar icon. The side panel opens. Click **[ capture ]** or press **Space** to start.

If you get a permissions error, click the Sieve icon while on the target tab first, then capture. Setting "On all sites" removes this requirement entirely.

## Features

- Live sieve canvas with animated particles and hole-based note visualization
- Chord name, confidence bar, and hold timer updated in real time
- Key detection (major / minor)
- Sharps / flats toggle
- Configurable time window (10s / 20s / 30s / infinite)
- Top chords with duration percentage and hit count
- Chord progression with copy button
- Chord tooltip on hover showing constituent notes
- Session results overlay with copy summary and audio download
- History tab with YouTube thumbnails, timestamps, and search
- Themes: Navy, Crimson, Amber, Violet, Mono

## Project structure

```
background.js       service worker, tab capture coordination
offscreen/          audio processing and chord detection
sidepanel/          main UI (HTML, CSS, JS)
assets/icons/       toolbar icons (16, 32, 48, 128px)
lib/                shared utilities
```

## Permissions

- `tabCapture` - capture tab audio stream
- `activeTab` / `<all_urls>` - identify and target the playing tab
- `offscreen` - run audio processing outside the service worker
- `downloads` - save recorded audio
- `storage` - persist sessions and preferences
