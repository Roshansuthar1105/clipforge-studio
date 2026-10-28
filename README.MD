# ✂ ClipForge Studio

A fast, lightweight studio application for automatically downloading YouTube videos, slicing them into 9:16 vertical video clips (Shorts, Reels, TikTok) using **FastAPI**, **yt-dlp**, and **FFmpeg**, and publishing them directly to multiple **YouTube** and **Instagram** accounts with **One-Click Automation**.

---

## 📌 Features

- **🌟 Dynamic Blurred Backgrounds (9:16)**: Dual-stream FFmpeg filtergraph scales and applies heavy Gaussian box blur to fill 1080x1920 while keeping the original video sharp and centered.
- **⚡ Instant URL Metadata Preview**: Automatically fetches video thumbnail, title, channel name, duration, and view count via `yt-dlp` in under 1 second without downloading media.
- **⏱️ Visual Timeline Range Scrubber**: Easily select custom start/end points with quick-select preset chips (*First 30s*, *First 60s*, *First 3 Min*, *Full Video*).
- **📱 Built-in 9:16 Smartphone Player**: Test and preview rendered clips directly in your browser with a realistic phone mockup frame, loop playback, and one-click direct MP4 downloads.
- **🚀 One-Click Multi-Account Publishing**: Connect multiple YouTube channels and Instagram accounts. Select targets with checkboxes, customize title/caption, and publish directly to YouTube Shorts and Instagram Reels with a single click.
- **📡 OAuth 2.0 & Token Health Checking**: Built-in Google and Meta OAuth popup authentication, automatic token refresh for YouTube Data API v3, 60-day long-lived token exchange for Instagram Graph API, and live token validity checks (`🔄 Test`).
- **📜 Publish History Audit Log**: Automatic persistent tracking of all published clips, target platforms, timestamps, and clickable direct links to published YouTube Shorts and Instagram Reels.
- **🗑 Media Storage & Cleanup Manager**: Built-in disk space management with one-click deletion of cached downloaded YouTube source videos (`data/downloads`) and rendered 9:16 vertical clips (`data/clips`), individual clip deletion, and storage metrics inspection.
- **💾 Zero-Database Local Storage**: All account tokens and publishing history are saved locally in clean JSON flat files (`data/accounts.json`, `data/publish_history.json`).
- **Dynamic Text Overlays**: Title banners and "Part 1, Part 2..." badges rendered directly onto video segments using FFmpeg's `drawtext`.
- **🎨 Premium Dark Studio UI**: High-end glassmorphic dark interface with real-time multi-stage progress tracking (Queue ➔ Download ➔ Slice ➔ Ready).
- **RESTful API**: Background threaded processing with full Swagger documentation at `/docs`.
- **Cross-Platform Compatibility**: Native support for Windows (Arial font) and Linux/Docker (DejaVu font).

---

## 📁 Project Structure

```text
clipforge-studio/
├── main.py                    # FastAPI server & route orchestration
├── storage.py                 # Thread-safe JSON flat-file storage manager
├── yt_to_clips.py             # CLI version of the video processing pipeline
├── requirements.txt           # Python package dependencies
├── .env.example               # Template for API keys & OAuth secrets
├── .env                       # Local environment variables (kept out of git)
├── YOUTUBE_OAUTH_SETUP.md     # Dedicated YouTube / Google OAuth step-by-step guide
├── INSTAGRAM_OAUTH_SETUP.md   # Dedicated Instagram / Meta Graph API step-by-step guide
├── Dockerfile                 # Production container configuration
│
├── accounts/                  # YouTube & Instagram account management
│   ├── models.py              # Account Pydantic models with token redaction
│   ├── manager.py             # Account CRUD & token health verification
│   ├── youtube_oauth.py       # Google OAuth 2.0 flow & channel fetching
│   └── instagram_oauth.py     # Meta Graph API flow & long-lived token exchange
│
├── publisher/                 # Multi-platform publishing engine
│   ├── models.py              # PublishRequest, PublishTarget & status models
│   ├── jobs.py                # Asynchronous publish orchestrator & state tracker
│   ├── history.py             # Publish history persistence layer
│   ├── youtube_publisher.py   # YouTube Data API v3 resumable chunked uploader
│   └── instagram_publisher.py # Instagram Graph API Reels container publisher
│
├── routers/                   # Modular FastAPI routers
│   ├── accounts_router.py     # /accounts endpoints & OAuth callbacks
│   └── publish_router.py      # /publish endpoints & live status polling
│
├── static/
│   └── index.html             # Dark studio UI, accounts manager & 1-click publish
│
└── data/                      # Auto-generated local storage
    ├── downloads/             # Downloaded source YouTube videos
    ├── clips/                 # Rendered 9:16 vertical video clips
    ├── accounts.json          # Connected account credentials (tokens)
    └── publish_history.json   # Audit log of past published clips
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

## 🔑 Environment Variables Setup (`.env`)

ClipForge Studio uses a `.env` file to manage OAuth credentials for YouTube (Google Cloud) and Instagram (Meta for Developers), as well as configuration settings.

### Step 1: Create your `.env` file
Copy the provided `.env.example` file to create your `.env`:

- **Windows (PowerShell)**:
  ```powershell
  Copy-Item .env.example .env
  ```
- **Linux / macOS**:
  ```bash
  cp .env.example .env
  ```

### Step 2: Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `GOOGLE_CLIENT_ID` | Yes (for YT OAuth) | `""` | Google Cloud OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes (for YT OAuth) | `""` | Google Cloud OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Yes (for YT OAuth) | `http://localhost:8000/accounts/youtube/callback` | OAuth callback redirect URL registered in Google Cloud Console |
| `META_APP_ID` | Yes (for IG OAuth) | `""` | Meta / Facebook App ID |
| `META_APP_SECRET` | Yes (for IG OAuth) | `""` | Meta App Secret |
| `META_REDIRECT_URI` | Yes (for IG OAuth) | `http://localhost:8000/accounts/instagram/callback` | OAuth redirect URL registered in Meta App Settings |
| `PUBLIC_BASE_URL` | Yes (for IG Publishing) | `http://localhost:8000` | Publicly reachable base URL used by Instagram servers to fetch video clips (use ngrok in development) |
| `DATA_DIR` | Optional | `data` | Base directory for downloads, clips, and JSON storage |
| `YTDLP_COOKIES` | Optional | `""` | Optional path to a `cookies.txt` file for bypassing YouTube bot checks |

---

### Step 3: Getting Your Google / YouTube OAuth Credentials

> [!TIP]
> **Detailed Guide Available**: For a comprehensive walkthrough with test user setup, redirect URI details, and troubleshooting for common Google error screens, see the dedicated guide:  
> 📖 **[YOUTUBE_OAUTH_SETUP.md](file:///d:/Projects/clipforge-studio/YOUTUBE_OAUTH_SETUP.md)**

To enable direct publishing to YouTube Shorts:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `ClipForge Studio`).
3. In the left navigation, go to **APIs & Services > Library**.
4. Search for **YouTube Data API v3** and click **Enable**.
5. Configure the **OAuth consent screen**:
   - Go to **APIs & Services > OAuth consent screen**.
   - Choose **External** user type and click **Create**.
   - Fill in **App Name** (`ClipForge Studio`) and **User Support Email**.
   - In the **Scopes** step, click **Add or Remove Scopes** and add:
     - `https://www.googleapis.com/auth/youtube.upload`
     - `https://www.googleapis.com/auth/youtube.readonly`
     - `https://www.googleapis.com/auth/userinfo.profile`
   - In the **Test users** step, add your personal Google account email address.
6. Create Credentials:
   - Go to **APIs & Services > Credentials**.
   - Click **+ Create Credentials > OAuth client ID**.
   - Select **Web application** as the application type.
   - Set **Name** to `ClipForge Web Client`.
   - Under **Authorized redirect URIs**, add:
     ```text
     http://localhost:8000/accounts/youtube/callback
     ```
   - Click **Create**.
7. Copy the **Client ID** and **Client Secret** into your `.env` file:
   ```env
   GOOGLE_CLIENT_ID=your_actual_google_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-your_actual_client_secret
   GOOGLE_REDIRECT_URI=http://localhost:8000/accounts/youtube/callback
   ```

---

### Step 4: Getting Your Meta / Instagram Graph API Credentials

> [!TIP]
> **Detailed Guide Available**: For a comprehensive walkthrough on creating your Meta Business App, linking Instagram to a Facebook Page, setting up ngrok for Reels, and using the Graph API Explorer, see the dedicated guide:  
> 📖 **[INSTAGRAM_OAUTH_SETUP.md](file:///d:/Projects/clipforge-studio/INSTAGRAM_OAUTH_SETUP.md)**

To enable direct publishing to Instagram Reels:

1. Go to [Meta for Developers](https://developers.facebook.com/).
2. Click **My Apps > Create App**.
3. Select app type: **Business** (or **Other > Business**).
4. Enter an App Name (e.g. `ClipForge Publisher`) and click **Create App**.
5. In the App Dashboard, locate and set up the following products:
   - **Instagram Graph API**
   - **Facebook Login for Business** (or Facebook Login)
6. Configure Facebook Login Redirect URI:
   - In the left sidebar, click **Facebook Login > Settings**.
   - Under **Valid OAuth Redirect URIs**, add:
     ```text
     http://localhost:8000/accounts/instagram/callback
     ```
   - Save changes.
7. Get your App ID and Secret:
   - In the left sidebar, go to **App Settings > Basic**.
   - Copy **App ID** and click **Show** to copy **App Secret**.
8. Ensure your Instagram account is set up properly:
   - Your Instagram account must be an **Instagram Business or Creator Account** (convert in Instagram app: Settings > Account type > Switch to professional account).
   - Your Instagram professional account must be linked to a **Facebook Page** that you manage.
9. Add the credentials to your `.env` file:
   ```env
   META_APP_ID=your_actual_meta_app_id
   META_APP_SECRET=your_actual_meta_app_secret
   META_REDIRECT_URI=http://localhost:8000/accounts/instagram/callback
   ```

---

### Step 5: Setting `PUBLIC_BASE_URL` for Instagram (Development / Localhost)

> [!IMPORTANT]
> **Why is this needed?**  
> Instagram Graph API is an asynchronous server-to-server API: when you request an upload, Meta's servers download the video file from your server over the public internet. Meta cannot download files from `http://localhost:8000`.

In local development, expose your localhost using a tunnel like **ngrok**:

1. Install [ngrok](https://ngrok.com/) or run:
   ```bash
   ngrok http 8000
   ```
2. Copy the forwarding HTTPS URL provided by ngrok (e.g. `https://a1b2-c3d4.ngrok-free.app`).
3. Update `PUBLIC_BASE_URL` in your `.env` file:
   ```env
   PUBLIC_BASE_URL=https://a1b2-c3d4.ngrok-free.app
   ```
4. In production (e.g., VPS, Render, AWS), simply set `PUBLIC_BASE_URL` to your production domain:
   ```env
   PUBLIC_BASE_URL=https://clipforge.yourdomain.com
   ```

---

### Step 6: Quick "Manual Token" Connection Alternative

If you already have access tokens from the [Google OAuth Playground](https://developers.google.com/oauthplayground) or [Meta Graph API Explorer](https://developers.facebook.com/tools/explorer/), you can connect accounts instantly without configuring full OAuth applications:

1. Open ClipForge Studio in your browser.
2. Click **📡 Connected Accounts** in the top navigation.
3. Click **🔑 Manual Token**.
4. Enter the platform (`YouTube` or `Instagram`), account alias, and access token, then click **Save Account**.

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

### 1. Connect Your Social Accounts
1. Click **📡 Connected Accounts** in the top navigation bar.
2. Click **▶ Connect YouTube** or **📷 Connect Instagram** to authenticate via the popup window.
3. Once authenticated, your channel name, avatar, and token health will appear.
4. Click **🔄 Test** anytime to verify that the credentials are active and healthy.

### 2. Slicing Vertical Clips
1. Paste any valid YouTube video URL — the thumbnail and metadata card load automatically.
2. Configure your clipping options:
   - **Time Range Boundaries**: Set custom seconds or use quick chips (*First 30s*, *First 60s*, *First 3 Min*, *Full Video*).
   - **Duration & Count**: Set duration per clip and maximum number of clips.
   - **Background Style**: Choose **🌟 Cinematic Blur** (recommended) or **⬛ Classic Black**.
   - **Overlays**: Toggle Title Header banners and "Part X" badges.
3. Click **🧪 Preview Clip 1** (renders just clip 1 for rapid review) or **⚡ Generate All Clips**.
4. Test your generated clip in the 9:16 smartphone simulator.

### 3. One-Click Multi-Account Publishing
1. On any generated clip card, click **🚀 One-Click Publish** (or click Publish inside the 9:16 phone modal).
2. The One-Click Publish dialog will appear:
   - **Target Accounts**: Check off which YouTube channels and Instagram accounts to publish to.
   - **Remembered Selection**: ClipForge Studio automatically remembers your checked accounts in browser `localStorage`.
   - **Title & Caption**: Review or tweak the auto-filled title and captions.
   - **YouTube Privacy**: Select *Public*, *Unlisted*, or *Private*.
   - **Instagram Share**: Choose whether to cross-share the Reel to the Instagram profile feed.
3. Click **🚀 Publish to Selected (N accounts)**.
4. Watch live real-time progress. When finished, direct clickable links will appear:
   - **🔗 View YouTube Short** (`https://youtube.com/shorts/...`)
   - **🔗 View Instagram Reel** (`https://instagram.com/reel/...`)

### 4. Audit Past Publishes
Click **📜 Publish History** in the top navigation to view the audit log of all past publish runs, complete with timestamps, target accounts, success status, and live URLs.

---

## 🔌 REST API Endpoints

### Clip Generation Endpoints
- `GET /api/preview?url={url}`: Fetch video metadata and check cache.
- `POST /api/jobs`: Start background video download and 9:16 slicing.
- `GET /api/jobs/{job_id}`: Poll processing progress and file list.
- `GET /api/jobs/{job_id}/files/{filename}`: Download generated MP4 clip.
- `GET /media/clips/{filename}`: Direct stream/download of generated clip.

### Account Management Endpoints
- `GET /accounts`: List all connected accounts (tokens safely redacted).
- `DELETE /accounts/{account_id}`: Disconnect and remove an account.
- `GET /accounts/{account_id}/status`: Check token validity and test API connection.
- `GET /accounts/youtube/connect`: Get Google OAuth consent URL.
- `GET /accounts/youtube/callback`: Handle Google OAuth code callback.
- `GET /accounts/instagram/connect`: Get Meta Login authorization URL.
- `GET /accounts/instagram/callback`: Handle Meta OAuth code callback.
- `POST /accounts/manual`: Connect an account directly with a manual token.

### Publishing Endpoints
- `POST /publish`: Start background multi-target publish job.
- `GET /publish/{job_id}/status`: Poll real-time progress for all targets in a job.
- `GET /publish/history`: Retrieve full publish history log.
- `DELETE /publish/history/{job_id}`: Delete an entry from publish history.

---

## 🐳 Docker Setup (Optional)

You can containerize and run ClipForge Studio using Docker:

```bash
# Build the Docker image
docker build -t clipforge-studio .

# Run the container with persistent storage and environment variables
docker run -d \
  -p 8000:10000 \
  --env-file .env \
  -v ${PWD}/data:/var/data \
  --name clipforge \
  clipforge-studio
```

Access the application at [http://localhost:8000](http://localhost:8000).

---

## 📂 Output Locations

By default, persistent files are saved in the `data/` directory:
- **Original Downloads**: `data/downloads/`
- **Rendered Vertical Clips**: `data/clips/`
- **Connected Accounts**: `data/accounts.json`
- **Publish History**: `data/publish_history.json`

*(You can customize the base directory with the `DATA_DIR` environment variable).*

---

## 🗺️ Roadmap

- [x] **Core Studio Upgrade**: Dynamic Blurred Backgrounds, URL Metadata Preview, Visual Time Scrubber, 9:16 Smartphone Player, Premium Dark UI.
- [x] **Multi-Account & One-Click Publishing**: Support multiple YouTube channels & Instagram accounts, OAuth 2.0 flow, local JSON storage, and single-click direct publishing.
- [ ] **Recurring Auto-Scheduler**: Calendar-based scheduled automated video posting with APScheduler.
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
| **YouTube "Sign in to confirm you’re not a bot"** | ClipForge Studio automatically uses mobile API clients (`android`, `ios`, `mweb`) to bypass bot detection. For age-restricted or private videos, export your YouTube cookies into a `cookies.txt` file (e.g. using the "Get cookies.txt LOCALLY" browser extension) and place it in the project root directory. |
| **Google OAuth: "Redirect URI mismatch"** | Ensure the redirect URI in your Google Cloud Console exactly matches `http://localhost:8000/accounts/youtube/callback` and `http://127.0.0.1:8000/accounts/youtube/callback`. See detailed fix in [YOUTUBE_OAUTH_SETUP.md](file:///d:/Projects/clipforge-studio/YOUTUBE_OAUTH_SETUP.md#1-error-400-redirect_uri_mismatch). |
| **Google OAuth: "Access blocked: App has not completed verification"** | When in Testing mode, Google requires adding your Gmail as a **Test User** in Google Cloud Console. See detailed fix in [YOUTUBE_OAUTH_SETUP.md](file:///d:/Projects/clipforge-studio/YOUTUBE_OAUTH_SETUP.md#2-access-blocked-clipforge-studio-has-not-completed-the-google-verification-process-error-403). |
| **Instagram: "Failed to create container"** | Ensure `PUBLIC_BASE_URL` in `.env` is a publicly accessible HTTPS URL (e.g. using `ngrok http 8000`). Meta cannot download videos from `localhost`. See [INSTAGRAM_OAUTH_SETUP.md](file:///d:/Projects/clipforge-studio/INSTAGRAM_OAUTH_SETUP.md#2-instagram-requires-a-publicly-accessible-video-url-but-got-httplocalhost8000). |
| **Instagram: "No accounts found"** | Verify that your Instagram account is an **Instagram Business or Creator** account and is linked to a **Facebook Page** that you manage. See [INSTAGRAM_OAUTH_SETUP.md](file:///d:/Projects/clipforge-studio/INSTAGRAM_OAUTH_SETUP.md#1-no-instagram-business-or-creator-accounts-linked-to-your-facebook-pages-were-found). |
