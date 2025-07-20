import os
import sys
import logging

logger = logging.getLogger(__name__)

def get_startup_handler():
    """
    Factory function that returns the appropriate startup handler for the current OS.
    
    Returns:
        StartupHandler: An instance of a platform-specific startup handler.
    """
    if sys.platform == "win32":
        logger.info("Using Windows startup handler.")
        return WindowsStartupHandler()
    elif sys.platform == "darwin":
        logger.info("Using macOS startup handler.")
        return MacOSStartupHandler()
    else:  # Assuming other POSIX systems are Linux-like
        logger.info("Using Linux startup handler.")
        return LinuxStartupHandler()

class StartupHandler:
    """Base class for handling platform-specific 'run on startup' logic."""
    
    def __init__(self):
        """Initializes paths and commands based on whether running as a script or a frozen executable."""
        self.is_frozen = getattr(sys, 'frozen', False)
        
        if self.is_frozen:
            # Running as a bundled app (e.g., PyInstaller executable)
            self.executable_path = sys.executable
            self.app_dir = os.path.dirname(self.executable_path)
            self.command = f'"{self.executable_path}"'
            self.program_args = [self.executable_path]
            logger.info(f"Running as a frozen executable: {self.executable_path}")
        else:
            # Running as a Python script
            self.script_path = os.path.abspath(sys.argv[0])
            self.app_dir = os.path.dirname(self.script_path)
            python_exe = sys.executable
            
            # On Windows, prefer pythonw.exe to avoid a console window on startup
            if sys.platform == "win32":
                pythonw_path = python_exe.replace("python.exe", "pythonw.exe")
                if os.path.exists(pythonw_path):
                    python_exe = pythonw_path
            
            self.command = f'"{python_exe}" "{self.script_path}"'
            self.program_args = [python_exe, self.script_path]
            logger.info(f"Running as a script: {self.command}")

    def enable(self):
        """Enables the application to run on system startup."""
        raise NotImplementedError

    def disable(self):
        """Disables the application from running on system startup."""
        raise NotImplementedError

class WindowsStartupHandler(StartupHandler):
    """Handles startup for Windows by creating a .bat file in the Startup folder."""
    def __init__(self):
        super().__init__()
        self.startup_dir = os.path.join(os.environ['APPDATA'], 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
        self.shortcut_path = os.path.join(self.startup_dir, "FNote.bat")

    def enable(self):
        logger.info(f"Enabling startup by creating file at: {self.shortcut_path}")
        os.makedirs(self.startup_dir, exist_ok=True)
        # cd to app dir to ensure relative paths for db/config work correctly
        bat_content = f'@echo off\ncd /d "{self.app_dir}"\nstart "" {self.command} --from-startup'
        with open(self.shortcut_path, 'w') as f:
            f.write(bat_content)
        logger.info("Startup enabled successfully.")

    def disable(self):
        logger.info(f"Disabling startup by deleting file: {self.shortcut_path}")
        if os.path.exists(self.shortcut_path):
            os.remove(self.shortcut_path)
            logger.info("Startup disabled successfully.")
        else:
            logger.info("Startup file did not exist, nothing to do.")

class MacOSStartupHandler(StartupHandler):
    """Handles startup for macOS by creating a .plist file in ~/Library/LaunchAgents."""
    def __init__(self):
        super().__init__()
        self.launch_agents_dir = os.path.expanduser('~/Library/LaunchAgents')
        self.plist_path = os.path.join(self.launch_agents_dir, 'com.fnote.app.plist')

    def enable(self):
        logger.info(f"Enabling startup by creating plist at: {self.plist_path}")
        os.makedirs(self.launch_agents_dir, exist_ok=True)
        program_args_with_flag = self.program_args + ['--from-startup']
        program_args_xml = '\n'.join(f'        <string>{arg}</string>' for arg in program_args_with_flag)
        plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fnote.app</string>
    <key>ProgramArguments</key>
    <array>
{program_args_xml}
    </array>
    <key>WorkingDirectory</key>
    <string>{self.app_dir}</string>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"""
        with open(self.plist_path, 'w') as f:
            f.write(plist_content)
        logger.info("Startup enabled successfully.")

    def disable(self):
        logger.info(f"Disabling startup by deleting file: {self.plist_path}")
        if os.path.exists(self.plist_path):
            os.remove(self.plist_path)
            logger.info("Startup disabled successfully.")
        else:
            logger.info("Startup plist did not exist, nothing to do.")

class LinuxStartupHandler(StartupHandler):
    """Handles startup for Linux by creating a .desktop file in ~/.config/autostart."""
    def __init__(self):
        super().__init__()
        self.autostart_dir = os.path.expanduser('~/.config/autostart')
        self.desktop_file_path = os.path.join(self.autostart_dir, 'fnote.desktop')

    def enable(self):
        logger.info(f"Enabling startup by creating .desktop file at: {self.desktop_file_path}")
        os.makedirs(self.autostart_dir, exist_ok=True)
        desktop_content = f"""[Desktop Entry]
Type=Application
Exec={self.command} --from-startup
Path={self.app_dir}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Name=FNote
Comment=Start FNote on login
"""
        with open(self.desktop_file_path, 'w') as f:
            f.write(desktop_content)
        logger.info("Startup enabled successfully.")

    def disable(self):
        logger.info(f"Disabling startup by deleting file: {self.desktop_file_path}")
        if os.path.exists(self.desktop_file_path):
            os.remove(self.desktop_file_path)
            logger.info("Startup disabled successfully.")
        else:
            logger.info("Startup .desktop file did not exist, nothing to do.")