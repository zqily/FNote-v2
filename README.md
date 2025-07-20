<p align="center">
  <img src="https://raw.githubusercontent.com/zqil/FNote/main/.github/assets/icon.png" alt="FNote Logo" width="128">
</p>

<h1 align="center">FNote Music Player</h1>

<p align="center">
  <strong>A sleek, tag-based music player for content creators, built with Python & Gemini.</strong>
</p>

<p align="center">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
    <img src="https://img.shields.io/badge/python-3.8+-informational.svg" alt="Python Version">
    <a href="https://www.youtube.com/@Zqily"><img src="https://img.shields.io/badge/YouTube-%40Zqily-red" alt="YouTube"></a>
    <a href="https://github.com/zqil/FNote/actions/workflows/python-app.yml"><img src="https://github.com/zqil/FNote/actions/workflows/python-app.yml/badge.svg" alt="CI Status"></a>
    <a href="https://gemini.google.com/"><img src="https://img.shields.io/badge/Made%20with-Gemini%20AI-9A4BEE" alt="Made with Gemini"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/zqil/FNote/main/.github/assets/fnote_showcase.gif" alt="FNote Showcase GIF">
</p>

FNote is a modern, offline music player designed from the ground up to help content creators and streamers quickly find the perfect track for their content. Instead of just playlists, FNote uses a powerful tagging system, allowing you to categorize your music by **Genre**, **Mood**, and **Use Case**.

## ✨ Key Features

-   🎵 **Powerful Tagging System**: Organize your library with customizable tags for Genre, Mood, Vibe, Use Case, and more.
-   🌐 **Download from URL**: Directly import audio from YouTube, SoundCloud, and hundreds of other sites, powered by `yt-dlp`.
-   🎨 **Dynamic Accent Colors**: The UI automatically adapts its accent color based on the current song's cover art for a beautiful, immersive experience.
-   🔍 **Advanced Search**: Instantly filter your current list or search your entire library by title, artist, and multiple tags at once.
-   ⏯️ **Mini-Player Mode**: Shrink the player down to a sleek, always-on-top widget for easy control while you work.
-   🎧 **Auto-Pause**: FNote intelligently pauses your music when another application plays audio and resumes when it's done. (Windows, with experimental support for macOS/Linux)
-   💬 **Discord Integration**: Show your currently playing track on your Discord profile with Rich Presence.
-   📦 **Portable Playlists**: Import and export playlists in the `.fnlist` format, which bundles all metadata and audio files into a single, shareable archive.
-   ⌨️ **Full Keyboard Control**: Navigate, manage, and control your music without ever touching the mouse.

## 🚀 Installation

The easiest way to get started is by using the official installer for your operating system.

### Windows

1.  Go to the [**Releases**](https://github.com/zqil/FNote/releases) page.
2.  Download the `FNote-Setup.exe` file from the latest release.
3.  Run the installer. It includes everything you need, including FFmpeg for URL downloads.

### From Source (For Developers)

If you'd rather build from the source, you can follow these steps:

1.  **Prerequisites**:
    *   Python 3.8+
    *   Git
    *   [FFmpeg](https://ffmpeg.org/download.html) (must be in your system's PATH for URL downloads to work)

2.  **Clone and Install**:
    ```bash
    # Clone the repository
    git clone https://github.com/zqil/FNote.git
    cd FNote

    # Create a virtual environment (recommended)
    python -m venv venv
    source venv/bin/activate  # On Windows, use `venv\Scripts\activate`

    # Install dependencies
    pip install -r requirements.txt
    ```

3.  **Run the App**:
    ```bash
    python app.py
    ```

## 🛠️ Tech Stack

-   **Backend**: Python
-   **GUI**: `pywebview` (a lightweight cross-platform wrapper around native webview components)
-   **Database**: SQLite
-   **Frontend**: Vanilla JavaScript (ESM), HTML5, CSS3
-   **Audio Metadata**: `mutagen`
-   **Packaging**: `PyInstaller` (for the executable) & `Inno Setup` (for the Windows installer)

## A Story from the Creator

Hey, I'm **zqil**! I'm a YouTuber and a self-proclaimed AI coder. I had this idea for a music player that worked the way *I* think about music for my videos—not by album, but by vibe and use case. So, I decided to build it.

Here's the fun part: **I wrote this entire application with the help of Google's Gemini.** It was an incredible journey of prompting, debugging, and learning alongside an AI. From the complex database logic in Python to the intricate UI animations in JavaScript, Gemini was my coding partner.

If you're curious about my work or want to see what else I'm up to, check me out!
-   **YouTube**: [youtube.com/@Zqily](https://www.youtube.com/@Zqily)
-   **Website**: [zqil.net](http://zqil.net)

## ❤️ Contributing

Contributions are welcome! Whether it's a bug report, a feature request, or a pull request, your help is appreciated. Please read the [**Contributing Guidelines**](./CONTRIBUTING.md) to get started.

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
