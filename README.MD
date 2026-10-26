# ✂ ClipForge Studio

A fast, lightweight application for automatically downloading YouTube videos and slicing them into 9:16 vertical video clips (Shorts, Reels, TikTok) using **FastAPI**, **yt-dlp**, and **FFmpeg**.

---

## 📌 Features

- **🌟 Dynamic Blurred Backgrounds (9:16)**: Dual-stream FFmpeg filtergraph scales and applies heavy Gaussian box blur to fill 1080x1920 while keeping the original video sharp and centered.
- **⚡ Instant URL Metadata Preview**: Automatically fetches video thumbnail, title, channel name, duration, and view count via `yt-dlp` in under 1 second without downloading media.
- **⏱️ Visual Timeline Range Scrubber**: Easily select custom start/end points with quick-select preset chips (*First 30s*, *First 60s*, *First 3 Min*, *Full Video*).
- **📱 Built-in 9:16 Smartphone Player**: Test and preview rendered clips directly in your browser with realistic phone mockup frame, loop playback, and one-click direct MP4 downloads.
- **Dynamic Text Overlays**: Title banners and "Part 1, Part 2..." badges rendered directly onto video segments using FFmpeg's `drawtext`.
- **🎨 Premium Dark Studio UI**: High-end glassmorphic dark interface with real-time multi-stage progress tracking (Queue ➔ Download ➔ Slice ➔ Ready).
- **RESTful API**: Background threaded processing with full Swagger documentation at `/docs`.
- **Cross-Platform Compatibility**: Native support for Windows (Arial font) and Linux/Docker (DejaVu font).

---

## 📁 Project Structure

```
clipforge-studio/
├── main.py              # FastAPI server, background job manager, & FFmpeg pipeline
├── requirements.txt     # Python package requirements
├── Dockerfile           # Production container configuration
├── static/
│   └── index.html       # Modern dark studio UI with 9:16 phone simulator
└── data/                # Auto-generated storage directory
    ├── downloads/       # Downloaded source videos
    └── clips/           # Rendered vertical clips
```

---

## ⚙️ Prerequisites

1. **Python 3.10+**
2. **FFmpeg & FFprobe**: Required for media processing and probe calculations.
   - **Windows (via Winget)**:
     ```powershell
     winget install Gyan.FFmpeg
     ```
   - **Windows (via Chocolatey)**:
     ```powershell
     choco install ffmpeg
     ```
   - **Linux (Debian/Ubuntu)**:
     ```bash
     sudo apt update && sudo apt install -y ffmpeg fonts-dejavu-core
     ```
   - Verify installation:
     ```bash
     ffmpeg -version
     ffprobe -version
     ```

---

## 🚀 Setup & Installation

### 1. Clone or Open the Repository
```powershell
cd d:\Projects\clipforge-studio
```

### 2. Create and Activate Virtual Environment

- **Windows (PowerShell)**:
  ```powershell
  python -m venv venv
  .\venv\Scripts\activate
  ```
  *(If you get a script execution policy restriction, run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`)*

- **Linux / macOS**:
  ```bash
  python3 -m venv venv
  source venv/bin/activate
  ```

### 3. Install Python Dependencies
```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

---

## 🎬 Running the Application

### Start the Development Server
With your virtual environment activated, run:
```bash
python -m uvicorn main:app --reload
```

Once running, access:
- **Web Dashboard**: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Interactive API Docs (Swagger)**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Health Check**: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

To stop the server, press `Ctrl + C` in your terminal.

---

## 💻 How to Use

### Method 1: Using the Web Dashboard
1. Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.
2. Paste any valid YouTube video URL — the thumbnail and metadata card will load automatically.
3. Configure your clip settings:
   - **Time Range**: Use the inputs or click a quick-chip (*First 30s*, *First 60s*, *First 3 Min*, *Full Video*).
   - **Clip Duration**: Set target duration in seconds (e.g., 30s or 60s).
   - **Background Style**: Choose between **🌟 Cinematic Blur** (recommended) or **⬛ Classic Black**.
   - **Overlay Toggles**: Enable/disable title headers and "Part X" badges.
4. Click **⚡ Generate Vertical Clips**.
5. Watch live progress in the status log. Once complete:
   - Click **📱 Preview** to watch the clip inside the built-in 9:16 smartphone simulator.
   - Click **⬇ Save** to download the MP4 file directly.

---

### Method 2: Using the REST API

#### 1. Preview YouTube Metadata (`GET /api/preview`)
```bash
curl "http://127.0.0.1:8000/api/preview?url=https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

#### 2. Trigger Clip Generation (`POST /api/jobs`)
```bash
curl -X POST "http://127.0.0.1:8000/api/jobs" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://www.youtube.com/watch?v=YOUR_VIDEO_ID",
       "title": "My Highlights",
       "clip_length": 30,
       "max_clips": 3,
       "start_seconds": 0,
       "end_seconds": 90,
       "background_style": "blur",
       "download_folder": "downloads",
       "clips_folder": "my_clips",
       "show_title": true,
       "show_parts": true,
       "keep_source": true
     }'
```

#### 3. Check Job Status (`GET /api/jobs/{job_id}`)
```bash
curl "http://127.0.0.1:8000/api/jobs/<JOB_ID>"
```

#### 4. Download Generated Clip (`GET /api/jobs/{job_id}/files/{filename}`)
```bash
curl -O "http://127.0.0.1:8000/api/jobs/<JOB_ID>/files/<FILENAME>"
```

---

## 🐳 Docker Setup (Optional)

You can containerize and run ClipForge Studio using Docker:

```bash
# Build the Docker image
docker build -t clipforge-studio .

# Run the container with persistent storage
docker run -d -p 8000:10000 -v ${PWD}/data:/var/data --name clipforge clipforge-studio
```

Access the application at [http://localhost:8000](http://localhost:8000).

---

## 📂 Output Locations

By default, files are saved in the `data/` directory:
- **Original Downloads**: `data/downloads/<download_folder>/`
- **Rendered Vertical Clips**: `data/clips/<clips_folder>/`

*(You can customize the base directory with the `DATA_DIR` environment variable).*

---

## 🗺️ Roadmap

- [x] **Core Studio Upgrade**: Dynamic Blurred Backgrounds, URL Metadata Preview, Visual Time Scrubber, 9:16 Smartphone Player, Premium Dark UI.
- [ ] **Multi-Account & Scheduler**: Support multiple YouTube channels & Instagram accounts, OAuth authentication, and scheduled automated video posting with APScheduler.
- [ ] **AI Captions & Typography**: Word-level kinetic animated subtitles via `faster-whisper`.
- [ ] **AI Auto-Highlights**: Automated hook detection and virality scoring.

---

## 🛠️ Troubleshooting

| Issue | Resolution |
| :--- | :--- |
| **`ffmpeg` / `ffprobe` not recognized** | Make sure FFmpeg is installed and the directory containing `ffmpeg.exe` and `ffprobe.exe` is added to your system `PATH`. Restart your terminal after updating PATH. |
| **Port 8000 already in use** | Run Uvicorn on another port: `python -m uvicorn main:app --reload --port 8001` |
| **PowerShell script execution disabled** | Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` to allow virtual environment activation scripts. |
| **Fonts not found on Linux** | Ensure `fonts-dejavu-core` is installed: `sudo apt install fonts-dejavu-core`. |
| **yt-dlp download failure** | Update `yt-dlp` to the latest release: `python -m pip install --upgrade yt-dlp`. |
| **YouTube "Sign in to confirm you’re not a bot"** | ClipForge Studio automatically uses mobile API clients (`android`, `ios`, `mweb`) to bypass bot detection. For age-restricted or private videos, export your YouTube cookies into a `cookies.txt` file (e.g. using the "Get cookies.txt LOCALLY" browser extension) and place it in the project root directory. |
