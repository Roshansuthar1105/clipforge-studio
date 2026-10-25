# ClipForge Studio

A local Windows application for downloading supported YouTube videos and generating vertical video clips using Python, yt-dlp, and FFmpeg.

## 1. Requirements

- Windows 10 or Windows 11
- Python installed
- FFmpeg and FFprobe installed and added to PATH
- Internet connection
- Permission to download and reuse the source video

## 2. Project Structure

```
D:\clipforge-studio\
├── main.py
├── requirements.txt
├── yt_to_clips.py
├── README.md
├── static\
│   └── index.html
└── data\
    ├── downloads\
    └── clips\
```

## 3. Install Python Dependencies

Open PowerShell and run:

```
cd D:\clipforge-studio
python -m pip install --upgrade pip
python -m pip install fastapi uvicorn yt-dlp Pillow python-multipart
```

If `python` is not recognized, try using `py` instead.

## 4. Install and Check FFmpeg

Check whether FFmpeg is installed:

```
ffmpeg -version
ffprobe -version
```

If either command is not recognized, install FFmpeg and add its `bin` folder to your Windows PATH. Restart PowerShell after updating PATH.

## 5. Start ClipForge Studio

Run:

```
cd D:\clipforge-studio
python -m uvicorn main:app --reload
```

Wait until the server reports that it has started.

Open the application:

- Dashboard: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- API documentation: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health check: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

Keep the PowerShell window open while using the application.

## 6. Generate Clips Through the API

Until the dashboard is connected to the backend, use the API documentation.

1. Open [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).
2. Expand `POST /api/jobs`.
3. Click **Try it out**.
4. Enter the following JSON, replacing the example URL with your own permitted video.

```
{
  "url": "https://www.youtube.com/watch?v=YOUR_VIDEO_ID",
  "title": "My Best Moments",
  "clip_length": 30,
  "max_clips": 5,
  "start_seconds": 0,
  "end_seconds": null,
  "download_folder": "downloads",
  "clips_folder": "my_clips",
  "show_title": true,
  "show_parts": true,
  "keep_source": true
}
```

5. Click **Execute** and copy the returned `job_id`.
6. Expand `GET /api/jobs/{job_id}`, click **Try it out**, enter the job ID, and click **Execute**.
7. Repeat the status check until the job is `completed` or `failed`.
8. Use the returned clip URLs to download your generated clips.

## 7. Output Folders

By default, downloaded source videos are saved under:

```
D:\clipforge-studio\data\downloads\
```

Generated clips are saved under:

```
D:\clipforge-studio\data\clips\my_clips\
```

The actual subfolder depends on the folder names supplied in the API request.

## 8. Stop the Application

In the PowerShell window running Uvicorn, press:

```
Ctrl + C
```

## 9. Troubleshooting

### Python is not recognized

```
py --version
```

If Python is installed and `py` works, use `py -m pip` and `py -m uvicorn` in place of `python -m pip` and `python -m uvicorn`.

### FFmpeg is not recognized

```
where.exe ffmpeg
where.exe ffprobe
```

Install FFmpeg or correct the Windows PATH configuration if either executable cannot be found.

### Port 8000 is already in use

Run the application on another port:

```
python -m uvicorn main:app --reload --port 8001
```

Then open [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs).

### Job fails

Check the error message returned by `GET /api/jobs/{job_id}`. Confirm that FFmpeg and FFprobe work, the output directory is writable, the URL is valid, and the source video is accessible.

### Titles do not render

Check that a supported font exists in:

```
C:\Windows\Fonts\
```

The application uses a Windows font for FFmpeg title overlays.

## 10. Important Notes

- The dashboard must make requests to the FastAPI backend to perform real downloads and clip generation.
- Publishing to YouTube or Instagram requires separate authentication and platform API integration.
- Download or use only content you own or are authorized to use, and follow the relevant platform's terms and copyright rules.
- This application is intended for local development and should not be exposed publicly without appropriate security measures.

## Step 5 — Quick start commands

Whenever you want to launch ClipForge Studio, run these two commands:

```
cd D:\clipforge-studio
python -m uvicorn main:app --reload
```

Then open \*\*http\://127.0.0.1:8000\*\*.

Important: Your current dashboard is still a prototype and needs its Generate button connected to the API for real processing. The API can be tested independently through `/docs`.
