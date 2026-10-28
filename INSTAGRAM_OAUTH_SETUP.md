# 📷 Instagram / Meta Graph API Setup Guide for ClipForge Studio

This guide walks you through setting up a **Meta (Facebook) Developer App** to enable **One-Click Direct Publishing** from ClipForge Studio to **Instagram Reels**.

---

## 📋 Prerequisites & Account Requirements

Meta has strict architectural rules for publishing content automatically via API. Ensure you have the following before starting:

1. **Instagram Account Type**:
   - Must be an **Instagram Business** or **Instagram Creator** account.
   - *Personal accounts cannot publish videos via API.*
   - **How to switch**: In the Instagram mobile app &rarr; **Settings and privacy** &rarr; **Account type and tools** &rarr; **Switch to professional account** (select Creator or Business).
2. **Linked Facebook Page**:
   - Your Instagram professional account **must be linked to a Facebook Page** that you manage.
   - **How to link**: In the Instagram mobile app &rarr; **Edit profile** &rarr; **Page** &rarr; Select or create a Facebook Page.
3. **Meta Developer Account**:
   - Free account at [developers.facebook.com](https://developers.facebook.com/).

---

## 🚀 Step-by-Step Meta Developer Setup

### Step 1: Create a Meta Developer App
1. Go to the [Meta for Developers Portal](https://developers.facebook.com/).
2. Log in with your Facebook account.
3. Click **My Apps** in the top-right corner &rarr; **Create App**.
4. In the use case selection, choose:
   - **Other** &rarr; click **Next**.
   - Select app type: **Business** &rarr; click **Next**.
   *(Do NOT choose "Consumer", as Consumer apps do not support Instagram Content Publishing).*
5. Enter your App Details:
   - **App name**: `ClipForge Studio` (or any name you prefer).
   - **App contact email**: Your email address.
   - **Business Account**: Optional (you can leave it unselected).
6. Click **Create app** (enter your Facebook password if prompted).

---

### Step 2: Add Required Products to Your App
In your new app's dashboard:

1. **Add Instagram Graph API**:
   - Scroll down to find **Instagram Graph API** (or search in the dashboard).
   - Click **Set up**.
2. **Add Facebook Login**:
   - In the left sidebar, click **Add Product** (or go back to the App Dashboard).
   - Locate **Facebook Login for Business** (or **Facebook Login**) and click **Set up**.

---

### Step 3: Configure Authorized Redirect URIs (**⚠️ CRITICAL**)
1. In the left navigation menu, expand **Facebook Login** (or **Facebook Login for Business**) &rarr; click **Settings**.
2. Scroll to the **Client OAuth settings** section.
3. Under **Valid OAuth Redirect URIs**, add **both** of the following:
   ```text
   http://localhost:8000/accounts/instagram/callback
   http://127.0.0.1:8000/accounts/instagram/callback
   ```
4. Scroll to the bottom and click **Save Changes**.

---

### Step 4: Get Your App ID and App Secret
1. In the left navigation menu, go to **App settings > Basic**.
2. You will see:
   - **App ID**: (e.g. `123456789012345`)
   - **App Secret**: Click **Show** (enter your Facebook password) to reveal the secret.
3. Keep this tab open.

---

### Step 5: Configure Your `.env` File
In your `clipforge-studio` project root, open your `.env` file and update the Meta variables:

```env
# Meta / Instagram OAuth
META_APP_ID=your_actual_meta_app_id
META_APP_SECRET=your_actual_meta_app_secret
META_REDIRECT_URI=http://localhost:8000/accounts/instagram/callback
```

---

### Step 6: Expose Localhost via ngrok (`PUBLIC_BASE_URL`) (**⚠️ CRITICAL FOR REELS**)

> [!IMPORTANT]
> **Why is `PUBLIC_BASE_URL` required?**  
> Unlike YouTube (which accepts video files streamed directly in HTTP chunks), the **Instagram Graph API is an asynchronous container API**:
> 1. ClipForge tells Meta: *"Here is the public HTTPS URL to my clip."*
> 2. Meta's servers download the video file from your server over the public internet.
> 3. Meta processes and publishes the video to Instagram.
>
> Because Meta's servers cannot reach `http://localhost:8000`, you must provide a public URL.

#### For Local Development (using ngrok):
1. Install [ngrok](https://ngrok.com/) (or run `winget install ngrok.ngrok` on Windows).
2. Open a new terminal and run:
   ```bash
   ngrok http 8000
   ```
3. Copy the **Forwarding** HTTPS address (e.g., `https://a1b2-c3d4.ngrok-free.app`).
4. Update `PUBLIC_BASE_URL` in your `.env`:
   ```env
   PUBLIC_BASE_URL=https://a1b2-c3d4.ngrok-free.app
   ```

#### For Production (VPS / Cloud):
Simply set `PUBLIC_BASE_URL` to your production domain:
```env
PUBLIC_BASE_URL=https://clipforge.yourdomain.com
```

---

### Step 7: Connect Instagram in ClipForge Studio
1. Start your ClipForge Studio server:
   ```powershell
   python -m uvicorn main:app --reload
   ```
2. Open [http://localhost:8000](http://localhost:8000).
3. Click **📡 Connected Accounts** in the top navigation.
4. Click **📷 Connect Instagram**.
5. A Meta authorization popup will open:
   - Log in with your Facebook account.
   - Select your Facebook Page and linked Instagram Business/Creator account.
   - Accept the requested permissions (`instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`).
6. The popup will automatically save the long-lived 60-day token, display your `@username` and profile avatar, and close.
7. Your account will now show with a green **● Active** badge!

---

## ⚡ Instant Alternative: Manual Token via Graph API Explorer

If you prefer not to configure a full Meta OAuth application, you can generate a token in 60 seconds using Meta's official Graph API Explorer:

1. Go to the [Meta Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Select your App in the top-right dropdown.
3. In the **User or Page** dropdown, select your **Facebook Page**.
4. In **Permissions**, add:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
5. Click **Generate Access Token**.
6. Query your Instagram account ID:
   ```text
   me?fields=instagram_business_account{id,username}
   ```
   Click **Submit**. Copy the Instagram `id` and your generated **Access Token**.
7. In ClipForge Studio:
   - Click **📡 Connected Accounts** &rarr; **🔑 Manual Token**.
   - Select **Instagram**.
   - Enter your `@username`, **Access Token**, and **Instagram User ID**.
   - Click **Save Account**.

---

## 🛠️ Troubleshooting Meta / Instagram Issues

### 1. "No Instagram Business or Creator accounts linked to your Facebook pages were found"
- **Cause**: Your Instagram account is either a personal account, or it has not been linked to a Facebook Page.
- **Fix**:
  1. In the Instagram app: go to **Settings &rarr; Account type & tools &rarr; Switch to professional account** (choose Creator or Business).
  2. In the Instagram app: go to **Edit profile &rarr; Page &rarr; Connect existing Page or create a new Page**.
  3. Ensure your Facebook account is an **Admin** of that Facebook Page.
  4. Try connecting again.

---

### 2. "Instagram requires a publicly accessible video URL, but got: http://localhost:8000..."
- **Cause**: `PUBLIC_BASE_URL` in `.env` is set to `localhost` or `127.0.0.1`.
- **Fix**:
  1. Start ngrok: `ngrok http 8000`.
  2. Copy the forwarding HTTPS URL.
  3. Set `PUBLIC_BASE_URL=https://your-subdomain.ngrok-free.app` in your `.env`.

---

### 3. "Failed to create Instagram container: OAuthException"
- **Cause**: Missing `instagram_content_publish` permission or expired token.
- **Fix**:
  1. Click **🔄 Test** next to your Instagram account in the Connected Accounts modal.
  2. If expired, disconnect the account and reconnect to exchange a fresh 60-day long-lived token.

---

### 4. "Feature unavailable / User cannot authenticate" (In Development Mode)
- **Cause**: While your Meta app is in "Development" mode, only users with a role on the app can authenticate.
- **Fix**:
  1. Go to [Meta Developer App Roles](https://developers.facebook.com/).
  2. In the left menu, click **App roles > Roles**.
  3. Add your personal Facebook account as an **Administrator**, **Developer**, or **Tester**.
