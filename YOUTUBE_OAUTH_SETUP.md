# 📺 YouTube / Google OAuth 2.0 Setup Guide for ClipForge Studio

This guide walks you through setting up Google Cloud OAuth 2.0 credentials to enable **One-Click Direct Publishing** from ClipForge Studio to YouTube Shorts.

---

## 📋 Prerequisites
- A Google / Gmail account with a YouTube channel created on it.
- ClipForge Studio installed and running locally (`http://localhost:8000` or `http://127.0.0.1:8000`).

---

## 🚀 Step-by-Step Setup

### Step 1: Create a Google Cloud Project
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown at the top left &rarr; **New Project**.
3. Enter Project Name: `ClipForge Studio` (or any name you prefer).
4. Click **Create** and ensure your new project is selected in the top bar.

---

### Step 2: Enable the YouTube Data API v3
1. In the left navigation menu, go to **APIs & Services > Library** (or open [API Library](https://console.cloud.google.com/apis/library)).
2. Search for: `YouTube Data API v3`.
3. Click on **YouTube Data API v3** in the results.
4. Click the blue **Enable** button.

---

### Step 3: Configure the OAuth Consent Screen
1. In the left navigation, go to **APIs & Services > OAuth consent screen** (or [Consent Screen](https://console.cloud.google.com/apis/credentials/consent)).
2. Select User Type: **External** (unless you are a Google Workspace organization user).
3. Click **Create**.
4. Fill in the **App Information**:
   - **App name**: `ClipForge Studio`
   - **User support email**: Select your email address.
   - **Developer contact information**: Enter your email address.
5. Click **Save and Continue**.
6. **Scopes** screen:
   - Click **Add or Remove Scopes**.
   - Filter or manually select these 3 scopes:
     - `.../auth/youtube.upload` *(Upload YouTube videos and manage your YouTube videos)*
     - `.../auth/youtube.readonly` *(View your YouTube account)*
     - `.../auth/userinfo.profile` *(See your personal info, including profile photo)*
   - Click **Update**, then **Save and Continue**.
7. **Test Users** screen (**⚠️ CRITICAL STEP**):
   > [!IMPORTANT]
   > While your Google app publishing status is in **"Testing"** mode, **only accounts added to the Test Users list can log in**. If you skip this, Google will block your login with:  
   > `Access blocked: ClipForge Studio has not completed the Google verification process`.
   - Under **Test users**, click **+ ADD USERS**.
   - Enter your **exact Google / Gmail address** (the account associated with your YouTube channel).
   - Click **Add / Save**.
8. Click **Save and Continue** &rarr; **Back to Dashboard**.

---

### Step 4: Create OAuth 2.0 Web Client Credentials
1. In the left menu, go to **APIs & Services > Credentials** (or [Credentials](https://console.cloud.google.com/apis/credentials)).
2. Click **+ Create Credentials** at the top &rarr; **OAuth client ID**.
3. Select **Application type**: **Web application**.
4. **Name**: `ClipForge Web Client`.
5. Scroll down to **Authorized redirect URIs** (**⚠️ CRITICAL STEP**):
   > [!WARNING]
   > Do NOT confuse **Authorized JavaScript origins** with **Authorized redirect URIs**.  
   > You must enter the exact URLs below under **"Authorized redirect URIs"**.
   - Click **+ Add URI** and add:
     ```text
     http://localhost:8000/accounts/youtube/callback
     ```
   - Click **+ Add URI** again and add:
     ```text
     http://127.0.0.1:8000/accounts/youtube/callback
     ```
   *(Adding both guarantees the callback works whether your browser opens `localhost` or `127.0.0.1`)*.
6. Click **Create**.
7. A dialog will appear with:
   - **Your Client ID** (e.g. `185853445240-xxxxxx.apps.googleusercontent.com`)
   - **Your Client Secret** (e.g. `GOCSPX-xxxxxx`)

---

### Step 5: Update Your `.env` File
In your `clipforge-studio` root folder, open or create `.env` and fill in your values:

```env
# Google / YouTube OAuth
GOOGLE_CLIENT_ID=185853445240-xxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxx
GOOGLE_REDIRECT_URI=http://localhost:8000/accounts/youtube/callback
```

> [!NOTE]
> ClipForge Studio automatically reloads `.env` dynamically when you make changes.

---

### Step 6: Test the Connection in ClipForge Studio
1. Start or refresh the server:
   ```powershell
   python -m uvicorn main:app --reload
   ```
2. Open [http://localhost:8000](http://localhost:8000) (or `http://127.0.0.1:8000`).
3. Click **📡 Connected Accounts** in the top navigation bar.
4. Click **▶ Connect YouTube**.
5. A Google authentication popup will open:
   - Select your test user Google account.
   - If prompted with *"Google hasn't verified this app"*, click **Advanced** &rarr; **Go to ClipForge Studio (unsafe)** &rarr; **Continue**.
   - Check all permissions and click **Continue**.
6. The popup will automatically show a success screen and close.
7. Your YouTube channel title, avatar, and **● Active** badge will appear in the Connected Accounts modal!

---

## 🛠️ Troubleshooting Google OAuth Errors

### 1. `Error 400: redirect_uri_mismatch`
- **Cause**: The redirect URI requested by the app does not match what was entered in Google Cloud Console.
- **Fix**:
  1. Go to [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials).
  2. Click on your OAuth 2.0 Client ID.
  3. Under **Authorized redirect URIs**, verify that:
     ```text
     http://localhost:8000/accounts/youtube/callback
     http://127.0.0.1:8000/accounts/youtube/callback
     ```
     are added with no trailing slash and no typos.
  4. Ensure you did not put them under "Authorized JavaScript origins".
  5. Click **Save** and wait 60 seconds for Google to sync.

---

### 2. `Access blocked: ClipForge Studio has not completed the Google verification process` (Error 403)
- **Cause**: The Google account you are logging in with is not listed under **Test users**.
- **Fix**:
  1. Go to [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent).
  2. Scroll down to **Test users**.
  3. Click **+ Add Users** and add the Gmail address you are trying to authenticate.
  4. Click **Save**.

---

### 3. `Google hasn't verified this app` Warning
- **Cause**: This is normal for apps in development mode that request sensitive YouTube scopes.
- **Fix**:
  1. Click the small link: **Advanced**.
  2. Click: **Go to ClipForge Studio (unsafe)**.
  3. Click **Continue** to grant permissions.

---

### 4. Direct "Manual Token" Fallback (No Google Cloud Project Required)
If you already have a token from [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
1. In ClipForge Studio, click **📡 Connected Accounts**.
2. Click **🔑 Manual Token**.
3. Select **YouTube**, input your Channel Name and Access Token, and click **Save Account**.
