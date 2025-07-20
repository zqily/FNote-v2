<p align="center">
  <img src="icon.png" alt="FNote Logo" width="128" height="128">
</p>

<h1 align="center">FNote - Your Local Music Sanctuary</h1>

<p align="center">
  A powerful, offline-first music library manager and player, built for creators and enthusiasts.
</p>

<p align="center">
  <a href="https://github.com/zqily/fnote/releases/latest">
    <img src="https://img.shields.io/github/v/release/zqily/fnote?style=for-the-badge&label=Latest%20Version" alt="Latest Release">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/zqily/fnote?style=for-the-badge&color=blue" alt="License">
  </a>
  <br>
  <img src="https://img.shields.io/badge/Windows-Supported-blue?style=flat-square&logo=windows" alt="Windows Support">
  <img src="https://img.shields.io/badge/macOS-From Source-lightgrey?style=flat-square&logo=apple" alt="macOS Support">
  <img src="https://img.shields.io/badge/Linux-From Source-lightgrey?style=flat-square&logo=linux" alt="Linux Support">
  <img src="https://img.shields.io/badge/Coded_with-Gemini_AI-4285F4?style=flat-square&logo=google" alt="Coded with Gemini">
</p>

---

FNote is more than just a music player; it's a powerful tool for managing your local and web-sourced audio library. Designed from the ground up to be fast, private, and highly customizable, FNote gives you complete control over your music without relying on cloud services.


*(**Note:** You should replace the link above with a direct link to a screenshot of your app!)*

## ✨ Key Features

-   🎵 **Universal Importer:** Import audio from local files or directly from URLs (YouTube, SoundCloud, and more) with automatic metadata fetching.
-   🏷️ **Advanced Tagging System:** Organize your library with a multi-category tagging system. Create, rename, merge, and delete tags to build the perfect organizational structure.
-   🔍 **Powerful Search:** Instantly filter your current view or perform a global search across your entire library by title, artist, or tags (`t:tagname`).
-   📜 **Robust Playlist Management:** Create unlimited playlists, reorder them with drag-and-drop, and easily move songs between them.
-   🚀 **Mini-Player Mode:** Switch to a sleek, always-on-top mini-player for unobtrusive playback control.
-   🎧 **Intelligent Auto-Pause:** FNote automatically pauses when another application plays audio and resumes when it's done (Windows supported, other OS experimental).
-   🎮 **Discord Rich Presence:** Show your friends what you're listening to with seamless Discord integration.
-   🎨 **Dynamic UI:** The user interface's accent color dynamically adapts to the cover art of the currently playing song.
-   ⚙️ **Highly Configurable:** Customize everything from startup behavior and notification duration to file associations and ignored applications for auto-pause.

## 🚀 Installation

### For Windows Users (Recommended)

The easiest way to get started is by downloading the latest installer from the Releases page.

1.  Go to the **[Latest Release](https://github.com/zqily/fnote/releases/latest)**.
2.  Download the `FNote-Setup.exe` file.
3.  Run the installer. It's a standard Inno Setup installer and includes the required **FFmpeg** for URL downloads.

### Running from Source (For macOS, Linux, and Developers)

If you're on a non-Windows OS or prefer to run from source:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/zqily/fnote.git
    cd fnote
    ```

2.  **Create a virtual environment and install dependencies:**
    ```bash
    # Create a venv
    python -m venv venv

    # Activate it
    # On Windows:
    .\venv\Scripts\activate
    # On macOS/Linux:
    source venv/bin/activate

    # Install requirements
    pip install -r requirements.txt
    ```

3.  **Run the application:**
    ```bash
    python app.py
    ```

## 🛠️ How It Works (Tech Stack)

FNote is built with a Python backend and a web-based frontend, creating a responsive and modern desktop application.

-   **Backend:** Python
-   **GUI Framework:** `pywebview` (a lightweight cross-platform wrapper around a webview)
-   **Database:** SQLite for fast, local data storage.
-   **Frontend:** Vanilla JavaScript (ESM), HTML5, CSS3.
-   **Audio Metadata:** `mutagen`
-   **URL Downloads:** `yt-dlp`

## 👨‍💻 About Me

Hi, I'm **zqil**!

I'm a YouTuber and a self-proclaimed AI coder. This entire application, from the Python backend to the complex JavaScript frontend, was developed as a personal project with the extensive help of Google's Gemini AI. It's a testament to how modern tools can empower solo developers to create complex, feature-rich applications.

You can find me here:
-   **GitHub:** [@zqily](https://github.com/zqily) (since zqil was taken!)
-   **YouTube:** [@Zqily](https://www.youtube.com/@Zqily)
-   **Website:** [zqil.net](http://zqil.net) (Yes, `http`! I'll get around to updating it... eventually.)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
