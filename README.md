# 🚀 MCP AI Image & Video Studio (Free Personal Gemini & DALL-E 3)

[![Stars](https://img.shields.io/github/stars/MohamedCHAMI/mcp-ai-image-generator?style=social)](https://github.com/MohamedCHAMI/mcp-ai-image-generator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**The Ultimate MCP Server for AI Media Generation - No Gemini API Key Required!**  
Seamlessly integrate the world's most powerful AI generators directly into your Model Context Protocol (MCP) clients (like Claude Desktop, Codex, etc.) or connect it directly to **ChatGPT on the Web**. 

Generate breathtaking images using **Google's Gemini (Imagen 3)** using your **free, personal Google account**! You don't need to pay for or configure a Google Cloud API key—this project uses your browser session to generate images for free. You can also generate images using **OpenAI's DALL-E 3** right from your chat interface!

---

## ✨ Features

- 🆓 **Free Personal Account Mode**: Generate and edit images using your free, personal Google account (via `gemini.google.com`). No API key, credit card, or Google Cloud setup needed!
- 🤖 **ChatGPT Web Support**: Includes an HTTP REST bridge and OpenAPI schema so you can use this directly in ChatGPT Custom GPTs!
- 🎨 **Multi-Model Image Support**: Access Google Gemini for free, plus optional support for OpenAI's `dall-e-3`.
- 💾 **Auto-Save & History**: All generated masterpieces are automatically saved locally with full history tracking.
- 🛠️ **Dynamic Configuration**: Configure your cookies or API keys on the fly directly from the chat.

---

## 🚀 Quick Start (Local MCP Clients)

### 1. Install

```bash
git clone https://github.com/MohamedCHAMI/mcp-ai-image-generator.git
cd mcp-ai-image-generator
npm install
npm run build
```

### 2. Configure your MCP Client (Claude, Codex, etc.)

Add this to your MCP client configuration (e.g., `claude_desktop_config.json`). Notice there are **no API keys** required for Gemini!

```json
{
  "mcpServers": {
    "mcp-ai-image-generator": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-ai-image-generator/dist/index.js"]
    }
  }
}
```

---

## 🔐 How to Connect Your Free Personal Google Account

Because official Gemini APIs can be used with generic MCPs, the magic of this project is that it uses your **personal email and browser session**. Here is how to connect it in 3 easy steps:

1. Go to [gemini.google.com](https://gemini.google.com/) in your regular web browser (Chrome, Safari, etc.) and log in to your personal account.
2. Open your browser's Developer Tools (Press `F12` or `Cmd+Option+I`) -> **Application** tab -> **Cookies** section -> click on `https://gemini.google.com`.
3. Find the cookie named **`__Secure-1PSID`** and copy its value.
4. Inside your AI client, just tell the AI: 
   > *"Run the `configure_google_login` tool and use `YOUR_COOKIE_VALUE` as the secure1psid."*

That's it! You can now generate images for free.

*(Note: If you also want to use OpenAI DALL-E 3, you can dynamically provide your API key by asking the AI to run the `configure_openai_api_key` tool).*

---

## 🔁 Refreshing cookies / switching to the official API (CLI)

The free `gemini-web` cookies expire periodically (Google rotates the session). Two ways to deal with it, both via the bundled CLI (no editing `~/.nano-banana/config.json` by hand, no secrets typed into chat):

(Run these from the project folder; `node dist/cli.js` is `prompt2pic` if you `npm link` it globally.)

**Refresh cookies (stays free):**
```bash
node dist/cli.js cookies
```
Prompts for `__Secure-1PSID` / `__Secure-1PSIDTS` with hidden input (not echoed, not saved to shell history). Grab the values the same way as above (DevTools → Application → Cookies → gemini.google.com). Restart the MCP server afterward to pick up the change.

**Switch to the official API key (never expires, billed):**
```bash
node dist/cli.js apikey
```
Prompts for a `GEMINI_API_KEY` (get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)), hidden input, no expiry to manage.

**Toggle between modes once both are configured:**
```bash
node dist/cli.js mode gemini-web   # free, cookie-based
node dist/cli.js mode apiKey       # official, no expiry
```

Non-interactive variants (`--psid`, `--psidts`, `--key`) exist for scripting but land the secret in shell history — prefer the interactive prompts.

---

## 🌐 How to Use with ChatGPT Web (Custom GPTs)

Want to use your free Gemini image generation directly inside ChatGPT on the web? This repo includes a built-in Express server and an `openapi.json` schema precisely for Custom GPT Actions.

### 1. Start the HTTP Bridge
Open your terminal in the project folder and start the REST server:
```bash
npm run serve-http
```
In a **new terminal tab**, expose the server to the internet using Ngrok (or Cloudflare):
```bash
ngrok http 3333
```
*Copy the `https://...` URL that Ngrok generates.*

### 2. Create the Custom GPT in ChatGPT
1. Go to **ChatGPT** -> Click your profile -> **My GPTs** -> **Create a GPT**.
2. Click the **Configure** tab.
3. Scroll down to the bottom and click **"Create new action"**.
4. In the **Schema** box, paste the entire contents of the `openapi.json` file from this repository.
5. In the Schema you pasted, find `https://YOUR_NGROK_URL_HERE` and replace it with your actual Ngrok URL.
6. Save and publish your Custom GPT!

### 3. Authenticate & Generate
In your new Custom GPT chat, simply tell ChatGPT:
> *"Configure my Google login using this cookie: [PASTE YOUR __Secure-1PSID COOKIE HERE]"*

ChatGPT will securely send the cookie to your local server. Once configured, you can just ask it naturally:
> *"Generate an image of a futuristic cyberpunk city."*

ChatGPT will route the request through your machine directly to Gemini using your personal account, completely free!

---

## 🛠️ Available Tools

### 🖼️ Free Gemini Images (Personal Account Mode)
- **`generate_image`**: Generate a new image using Gemini AI (Imagen 3).
- **`edit_image`**: Edit an existing image based on text instructions and a local file path.
- **`continue_editing`**: Automatically continue editing the last generated or edited image.
- **`configure_google_login`**: Set your `__Secure-1PSID` cookie for free personal account access.
- **`configure_gemini_browser_login`** / **`generate_gemini_browser_image`**: Alternative free mode that drives a real logged-in Chrome session at gemini.google.com (Playwright) instead of scraped cookies — no cookie re-extraction needed, but slower and depends on Gemini's UI staying stable.

### 🖼️ OpenAI Images (Requires API Key)
- **`generate_openai_image`**: Generate an image using DALL-E models. Parameters: `prompt`, `model`, `size`.
- **`configure_openai_api_key`**: Dynamically set your OpenAI API key.

### 🖼️ ChatGPT Web Images (Free, uses your ChatGPT account/subscription)
- **`configure_chatgpt_login`**: Opens a real Chrome window at chatgpt.com so you can log in by hand. Session is saved to a local persistent browser profile — run once.
- **`generate_chatgpt_image`**: Drives your logged-in ChatGPT session with Playwright to generate an image. No API key, but slower (real browser) and depends on ChatGPT's UI staying stable. Requires `configure_chatgpt_login` first.

For either browser tool, install Chromium once with `npx playwright install chromium`. The browser opens on your Mac for sign-in and generation.

### ⚙️ Utilities & Configuration
- **`get_status`**: Check current configuration, auth mode, and recent generations.
- **`list_history`**: View recently generated/edited images.

---

## 📁 Storage

- Images are automatically saved to your home directory: `~/nano-banana-images/`
- Your ChatGPT web login is stored as a browser profile at `~/.nano-banana/chatgpt-profile/`
- Your Gemini browser login is stored as a browser profile at `~/.nano-banana/gemini-browser-profile/`

Browser profiles contain login sessions. Keep them private and out of Git.

## ❤️ Contributing

Contributions, issues, and feature requests are welcome! If you like this project, please consider giving it a ⭐!
