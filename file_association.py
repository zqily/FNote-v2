import sys
import os
import logging
from python_utils import resource_path

logger = logging.getLogger(__name__)

def get_association_handler():
    """
    Factory function that returns the appropriate file association handler for the current OS.
    """
    if sys.platform == "win32":
        # Import will fail on other OS, so do it locally.
        try:
            import winreg
            logger.info("Using Windows file association handler.")
            return WindowsAssociationHandler(winreg)
        except ImportError:
            logger.error("Could not import winreg module on Windows.")
            return FileAssociationHandler()
    elif sys.platform == "darwin":
        logger.info("Using macOS file association handler (Info.plist).")
        return MacOSAssociationHandler()
    else:
        logger.info("Using generic Linux file association handler (placeholder).")
        return LinuxAssociationHandler()

class FileAssociationHandler:
    """Base class for handling platform-specific file type registration."""
    def __init__(self):
        self.is_frozen = getattr(sys, 'frozen', False)
        self.ext = ".fnlist"
        self.file_type_desc = "FNote Playlist"

        if self.is_frozen:
            # Running as a bundled app (e.g., PyInstaller executable)
            self.executable_path = sys.executable
            self.command = f'"{self.executable_path}" "%1"'
            self.icon_path = f'"{self.executable_path}",0'
        else:
            # Running as a Python script
            # Base the path on the main script being run, not this specific file.
            self.script_path = os.path.abspath(sys.argv[0])
            self.executable_path = sys.executable
            self.command = f'"{self.executable_path}" "{self.script_path}" "%1"'
            
            # Use resource_path for consistency to find assets from the project root.
            icon_file = resource_path('favicon.ico')
            self.icon_path = f'"{icon_file}"' if os.path.exists(icon_file) else f'"{self.executable_path}",0'

    def register(self):
        """Registers the .fnlist file type with the application."""
        logger.warning("File association not implemented for this platform.")
        raise NotImplementedError("File association not implemented for this platform.")

class WindowsAssociationHandler(FileAssociationHandler):
    """Handles file association for Windows using the registry."""
    def __init__(self, winreg_module):
        super().__init__()
        self.winreg = winreg_module
        self.prog_id = "FNote.fnlist.1"

    def register(self):
        try:
            logger.info(f"Registering '{self.ext}' extension with ProgID '{self.prog_id}'.")
            # HKEY_CLASSES_ROOT\.fnlist -> (Default) = FNote.fnlist.1
            with self.winreg.CreateKey(self.winreg.HKEY_CLASSES_ROOT, self.ext) as key:
                self.winreg.SetValue(key, '', self.winreg.REG_SZ, self.prog_id)

            # HKEY_CLASSES_ROOT\FNote.fnlist.1 -> (Default) = "FNote Playlist"
            with self.winreg.CreateKey(self.winreg.HKEY_CLASSES_ROOT, self.prog_id) as key:
                self.winreg.SetValue(key, '', self.winreg.REG_SZ, self.file_type_desc)

                # Set default icon
                with self.winreg.CreateKey(key, 'DefaultIcon') as icon_key:
                    self.winreg.SetValue(icon_key, '', self.winreg.REG_SZ, self.icon_path)
                    logger.info(f"Setting icon path to: {self.icon_path}")

                # Set shell open command
                with self.winreg.CreateKey(key, r'shell\open\command') as cmd_key:
                    self.winreg.SetValue(cmd_key, '', self.winreg.REG_SZ, self.command)
                    logger.info(f"Setting open command to: {self.command}")

            logger.info("File association registered successfully.")
        except PermissionError as e:
            logger.error("Permission denied to modify the registry. Administrator privileges are required.", exc_info=True)
            raise PermissionError("Administrator privileges are required to modify file associations.") from e
        except Exception as e:
            logger.error(f"An unexpected error occurred while writing to the registry: {e}", exc_info=True)
            raise RuntimeError(f"An unexpected error occurred while writing to the registry: {e}") from e

class MacOSAssociationHandler(FileAssociationHandler):
    """Placeholder for macOS. Association is handled by Info.plist in the app bundle."""
    def register(self):
        # On macOS, file associations are declared in the Info.plist file of the
        # application bundle. This is typically configured during the build process
        # (e.g., with PyInstaller's spec file). Programmatic registration is not
        # standard practice. We return success and let the user know via a toast.
        logger.info("macOS file association is handled by the app bundle's Info.plist. No programmatic action taken.")
        pass

class LinuxAssociationHandler(FileAssociationHandler):
    """Placeholder for Linux. Would use xdg-mime."""
    def register(self):
        # Implementation would involve creating a .desktop entry, a custom MIME type
        # XML file, and using `xdg-mime` and `update-mime-database`.
        # This is a placeholder for now.
        logger.warning("Programmatic file association on Linux is not yet implemented.")
        pass