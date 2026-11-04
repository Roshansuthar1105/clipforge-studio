# ClipForge Studio — Complete Feature & User Interaction Guide

This document provides a comprehensive guide to every feature available in the application, explaining what the platform does, how users interact with each tool, and the step-by-step actions performed on the site.

---

## 1. Overview: What This Website Does

ClipForge Studio is an all-in-one web studio designed for content creators to turn long videos into engaging, short-form vertical videos (Shorts, Reels, and TikToks). 

On this platform, users can:
- Import videos simply by pasting a link.
- Automatically cut videos into numbered sequential parts or use artificial intelligence to detect the most viral moments.
- Format widescreen videos into vertical 9:16 phone-ready layouts with blurred background expansion or center cropping.
- Transcribe speech into animated, word-by-word synced subtitles (including Hinglish transliteration and English translation).
- Add custom text overlays, banners, and part counters.
- Preview videos inside a realistic interactive smartphone simulator.
- Organize rendered clips and original downloads in a media library.
- Connect social accounts (YouTube, Instagram, Facebook) and publish or schedule clips across multiple channels simultaneously with a single click.
- Monitor background rendering tasks and verify internet connection speeds.

---

## 2. Source Video Import & Instant Preview

### How the User Interacts:
1. **Paste Video Link**: Users enter any YouTube video link or Shorts link into the input bar on the main Studio screen.
2. **One-Click Info Fetching**: Clicking **Fetch Info** instantly pulls the video's details without making the user wait for a full video download.
3. **Inspect Video Summary**:
   - The user immediately sees the video thumbnail, duration badge, title, channel name, and view count.
4. **Server Cache Indicator**: If the video was already downloaded or processed previously, a green badge informs the user that the media is already cached locally, avoiding duplicate downloads.
5. **Customizable Clip Title Prefix**: An editable text field allows users to set a custom title prefix that will automatically name all generated clips and serve as the upload title when publishing.
6. **Clear Input**: A dedicated clear button lets users reset the URL input with one click.

---

## 3. Slicing Modes

Users can choose between two primary ways to create vertical video clips:

### Mode A: Sequential Part Slicing
- **Purpose**: Ideal for podcasts, tutorials, interviews, or storytelling where the user wants to break a video into consecutive, ordered episodes (Part 1, Part 2, Part 3, etc.).
- **User Actions**:
  - The user selects **Sequential Part Slicing**.
  - The user configures clip length, total number of clips, and framing format.

### Mode B: AI Viral Moments Engine
- **Purpose**: Automatically scans the video’s spoken dialogue to find the most gripping, high-retention highlights and hooks.
- **User Actions**:
  - The user selects **AI Viral Moments**.
  - The user clicks **Scan Viral Moments**.
  - The system analyzes speech and presents a list of ranked viral segments, each scored from 0 to 100.
  - For each detected moment, the user can review:
    - An attention-grabbing **Headline**.
    - The exact **Opening Hook** spoken in the video.
    - The **Virality Score** (with visual high-score indicators).
    - An explanation of **why this moment is engaging**.
    - The exact time range and duration.
  - **Shocking Hook Teaser Toggle**: Users can check a box to automatically prepend a fast 1–5 second climax teaser to the start of the reel to immediately hook viewers.
  - **Auto-Burn Subtitles Toggle**: Users can enable automatic animated word-by-word subtitles for all generated viral clips.

---

## 4. Timeline Range & Quick-Select Presets

### How the User Interacts:
- **Custom Time Boundaries**: Users can type exact start and end points (in seconds) to slice only a specific portion of the video.
- **One-Click Presets**: Fast-select chips allow users to quickly set boundaries with a single click:
  - **First 30s**: Sets the range from 0 to 30 seconds.
  - **First 60s**: Sets the range from 0 to 60 seconds.
  - **First 3 Min**: Sets the range from 0 to 180 seconds.
  - **Full Video**: Automatically resets boundaries to cover the entire length of the video.

---

## 5. Clip Duration, Count & Framing Settings

### How the User Interacts:
- **Clip Duration Control**:
  - A slider adjusts clip duration between 15 and 180 seconds.
  - Quick-select buttons allow instant snapping to 30s, 45s, 60s, or 90s.
- **Maximum Clips Limit**:
  - A slider sets how many clips to generate (from 1 up to 20).
  - Quick-select chips let users choose 1, 3, 5, or 10 clips with a single tap.
- **9:16 Vertical Framing Options**:
  - **Dynamic Blurred Background**: Keeps the original widescreen video centered and sharp, while filling the vertical 9:16 mobile frame with an expanded, softly blurred background.
  - **Center Crop**: Crops directly into the center of the video to fill the entire vertical screen.
  - **Original Scale**: Keeps standard video proportions with clean top and bottom letterboxing.

---

## 6. Rendering & Fast Preview

### How the User Interacts:
- **Preview First Clip (Fast Slice)**: Generates only the first clip in seconds so the user can quickly check the framing, cropping, and audio before rendering the entire batch.
- **Render All Clips**: Dispatches the entire job to run in the background. The user can navigate to other pages while rendering proceeds.

---

## 7. Dedicated AI Viral Moments Studio

### How the User Interacts:
- Accessed either from the main studio or directly from any saved video in the media library.
- Users can scan any video link or previously downloaded video file.
- Displays all detected viral moments with their retention scores and timestamps.
- **Create Single Reel**: Users can click to generate an individual viral reel from any specific moment in the list.
- **Create All Viral Reels**: One-click batch button generates vertical reels for every detected viral moment simultaneously.

---

## 8. Subtitle & Caption Studio (Full-Page Interactive Suite)

The Subtitle Studio offers comprehensive control over on-screen captions, text styling, and language conversion.

### 8.1. Interactive 9:16 Phone Simulator
- **Live Video Playback**: Play, pause, and scrub through the clip using an interactive timeline slider.
- **Click-to-Position**: Clicking anywhere on the simulated phone screen automatically repositions the subtitles or text overlay to that exact vertical height.
- **Social Media Safe Zones**: A toggle button displays Instagram Reels and TikTok interface boundaries (showing where profile icons, like buttons, and bottom captions appear) so users ensure their text never gets covered by app icons.

### 8.2. Word-by-Word Synced Animated Captions
- Spoken words highlight in real time as the speaker talks.
- **Style Presets**: One-click style themes (including Hormozi, Neon, Clean, Beast, Minimal, and Gaming styles).
- **Typography Controls**:
  - Adjust font size with a live slider.
  - Adjust vertical subtitle position (percentage of screen height).
  - Adjust word count per screen (from 1 punchy word at a time up to 6 words).
  - Customize base text color and highlighted active-word color.
  - Customize text outline width and outline color for maximum readability.
  - Toggle uppercase text styling.

### 8.3. Language & Transliteration Tools
- **Hinglish Conversion (A-Z)**: Converts Hindi spoken audio written in Devanagari script into easy-to-read Roman English lettering with one click.
- **Translate to English**: Automatically translates foreign spoken dialogue into English subtitles.
- **Subtitle File Downloads**: One-click buttons to export subtitles as standard SubRip (`.SRT`) or Advanced SubStation Alpha (`.ASS`) files.

### 8.4. Subtitle Editing Tabs
- **Bulk Text Tab**:
  - Displays the full spoken transcript of the clip.
  - Allows editing the entire transcript directly.
  - **Find and Replace**: Search for specific words across the entire video and replace them all at once.
  - **Copy Caption**: One-click button copies the complete spoken text to the clipboard for use in social media descriptions.
- **Cue-by-Cue Tab**:
  - Displays each spoken phrase on a timeline with start and end timestamps.
  - Edit start and end times down to tenths of a second.
  - Shift all cues earlier or later by 0.5 seconds to correct audio synchronization.
  - Add new subtitle cues or delete unwanted ones.
  - Highlight specific words manually.

### 8.5. "Add Text on Video" Overlay Tool
- Allows adding static or timed text banners, episode titles, or callouts onto the video.
- **Banner Styles**: Choose between Plain Text, Rounded Box, or Full-Width Banner.
- **Custom Styling**: Change font family, font size, text color, box background color, box opacity, and outline.
- **Alignment**: Align text Left, Center, or Right.
- **Time Range**: Set text to appear for the whole video or between specific start and end seconds.
- **Application Scope**:
  - Apply to the current clip only.
  - Apply uniformly to all clips in the same video folder with a single action.

### 8.6. Video Burning
- **Burn Subtitles to Single Video**: Permanently embeds the styled subtitles and overlays into the selected clip.
- **Mount All in Group (Batch Processing)**: Applies the chosen subtitle styling and overlays across an entire series of clips in one click, tracking progress reel-by-reel.

---

## 9. Media Library & Storage Management

The Media Library organizes all created clips and downloaded source videos.

### 9.1. Rendered 9:16 Clips Tab
- **Automatic Grouping**: Clips are automatically organized into collapsible folders named after the original source video.
- **Folder Controls**:
  - Expand or collapse individual folders, or use the **Expand All** button.
  - Folder checkbox: Selects all clips inside a folder with one click.
  - **Batch Mount Subtitles**: Opens the entire folder in Subtitle Studio to process all clips together.
  - **Batch Publish**: Launches the publishing window with all clips in that folder pre-selected.
  - **Delete Folder**: Removes an entire folder and all its clips.
- **Actions on Individual Clips**:
  - **Phone Preview**: Opens the video in the 9:16 mobile mockup player.
  - **Subtitle Studio**: Opens the clip in the Subtitle Studio to customize captions.
  - **Publish**: Opens the single-clip publishing dialog.
  - **Direct Download**: Downloads the ready-to-share MP4 file directly to the user's computer.
  - **Delete**: Permanently removes the clip.
- **Cross-Folder Multi-Selection**:
  - Users can check individual clips across different folders.
  - A floating action bar displays the total selected count and provides buttons to **Batch Publish** or **Batch Delete** selected items.

### 9.2. Source Downloads Tab
- Displays all downloaded full-length original videos.
- Shows file name, duration, and file size.
- **Slice in Studio**: Directly sends the downloaded video into the Slicing Studio without needing to re-enter a URL or re-download.
- **AI Viral Moments**: Directly initiates viral highlight scanning on the saved file.
- **Download MP4**: Saves the full source video to the user's machine.
- **Delete**: Cleans up the downloaded file.

### 9.3. Search & Storage Cleanup Toolbar
- **Search Bar**: Real-time filtering of clips, folders, and downloads by title or keyword.
- **Disk Usage Meter**: Shows the exact storage space consumed by downloaded videos and rendered clips.
- **Clean Media Storage**: A one-click maintenance button that clears cached downloads and rendered files to instantly reclaim disk space.

---

## 10. Interactive 9:16 Mobile Mockup Player

### How the User Interacts:
- Clicking the preview icon on any clip opens an authentic smartphone mockup frame (complete with rounded bezels and top display notch).
- The video plays in an infinite loop with standard play, pause, volume, and fullscreen controls.
- Displays live animated subtitles and text banners exactly as they will look on mobile screens.
- **Quick Action Bar**:
  - **Download**: Instantly saves the MP4 file.
  - **Edit Subtitles**: Jumps directly into the Subtitle Studio for that clip.
  - **Publish**: Opens the social publishing modal with the video pre-loaded.

---

## 11. One-Click Multi-Account Social Publishing

Publishing videos directly to social networks without leaving the website.

### How the User Interacts:
1. **Target Selection**:
   - Checkboxes allow users to select any combination of connected YouTube channels, Instagram accounts, and Facebook Pages.
   - Users can publish to one account or broadcast to multiple accounts and platforms at the same time.
2. **Publishing Modes**:
   - **Publish Now**: Uploads and publishes the video immediately.
   - **Schedule for Later**: Opens a date and time picker allowing users to schedule the post for an automated future release.
3. **Title & Caption Customization**:
   - Custom title input for YouTube Shorts.
   - Custom description / caption input for Instagram and Facebook Reels.
   - **Dynamic Variables**: Users can write `{part}` or `{n}` in titles and captions, which automatically replaces with the correct number for each clip in a series (e.g., `"Episode {n}"` becomes `"Episode 1"`, `"Episode 2"`).
   - **1-Click Viral Hashtag Presets**: Tapping preset buttons instantly adds popular hashtags (`#shorts`, `#reels`, `#viral`, `#trending`, `#fyp`, `#clipforge`) into the caption.
4. **Batch Distribution**:
   - When multiple clips are selected, the system automatically titles sequential parts (e.g., appending `Part 1`, `Part 2`) and publishes them in proper numerical order.
5. **Live Progress Tracking**:
   - Displays real-time progress bars for each destination channel.
   - Displays stage updates during the upload.
   - Upon completion, presents **direct clickable links** that take the user straight to their live YouTube Short, Instagram Reel, or Facebook post.

---

## 12. Social Channel Hub (Accounts Management)

A centralized hub where users manage their social media authorizations and publishing channels.

### How the User Interacts:
- **Connect YouTube**: Initiates official authorization to link YouTube channels.
- **Connect Meta (Instagram & Facebook)**: Connects Instagram Professional accounts and Facebook Pages.
- **1-Click Automated Meta Connector**:
  - Allows users to paste an access token.
  - Automatically discovers, verifies, and links all associated Facebook Pages and Instagram accounts in seconds without manual ID lookups.
- **Manual Account Connection**: For advanced users, an input modal allows entering specific Account IDs, Page IDs, and access tokens manually.
- **Connection Health Checks**: Each connected channel has a **Test** button that immediately verifies whether the account authorization is active and ready for publishing.
- **Disconnecting Accounts**: Safely removes any connected account with one click.
- **YouTube Cookies Configuration**:
  - An interactive modal where users can paste or upload YouTube cookies.
  - Helps avoid bot verification blocks when fetching videos on hosted servers.
- **Built-in Setup Guides**: Dedicated documentation tab with step-by-step visual instructions for acquiring account credentials and configuring platform permissions.

---

## 13. Scheduled Posts Queue & Manager

A dedicated dashboard to view, edit, and control all queued social posts.

### How the User Interacts:
- **Queue Overview**: Displays all posts awaiting automated publication.
- **Live Countdown**: Shows the remaining time until each post goes live (e.g., `"In 2 hours, 15 min"`).
- **Edit Schedule**:
  - Change the scheduled date and time.
  - Update the post title or caption before it publishes.
- **Publish Now (Instant Release)**: Manually triggers immediate publishing ahead of schedule.
- **Cancel Post**: Removes the post from the schedule queue.
- **Status Filtering**: Filter scheduled posts by status (Scheduled, Published, Cancelled).

---

## 14. Publishing History & Audit Log

A permanent log tracking all previously published content.

### How the User Interacts:
- **Comprehensive History List**: Displays every published video with thumbnail, title, destination platforms, and exact timestamp.
- **Direct Live Links**: Clickable buttons navigate directly to the published YouTube Short, Instagram Reel, or Facebook post.
- **Platform Filters**: Quickly filter past posts by platform (All, YouTube, Instagram, Facebook).
- **Details Inspection**: Opens an audit modal showing post IDs, platform delivery statuses, and response records.
- **Log Management**: Delete individual history records or clear the entire history log.

---

## 15. Background Job Monitor & Sticky Progress Bar

Users never have to wait idly on a single screen while videos process.

### How the User Interacts:
- **Persistent Global Progress Bar**: A sticky progress indicator remains visible at the top of the screen across every tab, showing current progress for any active download, slicing, or subtitle burning task.
- **Background Jobs View**:
  - Displays all running, completed, and cancelled tasks.
  - Shows current status badges (Queued, Downloading, Slicing, Completed, Error).
  - Shows progress percentages and elapsed time.
  - Allows cancelling an active job or clearing completed tasks from the list.

---

## 16. User Authentication & Profile Management

### How the User Interacts:
- **Sign Up / Log In**: Modal dialog allows users to create an account or log into an existing account.
- **Personalized Session**: Keeps social channel connections and publishing history tied to the user.
- **Header Profile Indicator**: Shows current login status in the navigation bar.

---

## 17. User Experience & Navigation Highlights

- **Dark Studio Interface**: Eye-friendly, glassmorphic dark theme designed for media editing.
- **Instant Toast Alerts**: Non-intrusive notifications confirm actions (e.g., "Copied caption to clipboard", "Job started", "Published successfully").
- **Seamless Navigation**: Switch between Studio, Jobs, Library, Accounts, Subtitle Studio, Viral Moments, Guide, and Speed Test without losing active background progress.
- **Responsive Controls**: Fully accessible sliders, numerical steppers, color pickers, and toggles tailored for intuitive video creation.

