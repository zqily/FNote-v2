import sys
import os
import threading
import json
import subprocess
import re
import logging

import config_handler

logger = logging.getLogger(__name__)

# Platform-specific imports for auto-pause feature
PYCAW_AVAILABLE = False
if sys.platform == "win32":
    try:
        from pycaw.pycaw import AudioUtilities
        from comtypes import CoInitialize, CoUninitialize, COMError
        PYCAW_AVAILABLE = True
    except (ImportError, OSError):
        logger.warning("pycaw or its dependencies not found. Auto-pause feature will be disabled on Windows.")

# Import for Discord Rich Presence
PYPRESENCE_AVAILABLE = False
DISCORD_CLIENT_ID = "1395848010004566186"
try:
    import pypresence
    PYPRESENCE_AVAILABLE = True
except ImportError:
    logger.warning("pypresence not found. Discord Rich Presence will be disabled.")
except Exception as e:
    logger.warning(f"An unexpected error occurred while importing pypresence: {e}")


class BackgroundServices:
    def __init__(self, config, window_manager):
        self.config = config
        self.window_manager = window_manager
        
        # Auto-pause state
        self.auto_pause_thread = None
        self.stop_auto_pause_event = threading.Event()
        self.current_process_name = os.path.basename(sys.executable).lower()
        self.audio_proc_blacklist = [p.lower() for p in self.config.get('autoPauseAudioProcBlacklist', [])]

        # Discord Rich Presence state
        self.rpc = None
        self.rpc_thread = None

    def start(self):
        """Starts all enabled background services."""
        if self.config.get('autoPauseOnExternalAudio'):
            self.start_auto_pause_monitor()
        if self.config.get('discordRichPresence'):
            self.start_rich_presence()

    def shutdown(self):
        """Stops all running background services."""
        self.stop_auto_pause_monitor()
        self.stop_rich_presence()

    # --- Auto-pause logic ---
    def _monitor_external_audio(self):
        if sys.platform == "win32": self._monitor_audio_windows()
        elif sys.platform.startswith("linux"): self._monitor_audio_linux()
        elif sys.platform == "darwin": self._monitor_audio_macos()
        else: logger.warning(f"Auto-pause is not supported on this platform ({sys.platform}).")

    def _monitor_audio_windows(self):
        logger.info("Starting external audio monitor thread for Windows...")
        CoInitialize()
        last_state = False
        try:
            while not self.stop_auto_pause_event.is_set():
                is_external_audio_active, active_sources = False, []
                try:
                    for session in AudioUtilities.GetAllSessions():
                        if not (session.Process and session.State == 1): continue
                        try:
                            # The original GetPeakValue() method can be unreliable on systems with
                            # certain audio drivers or enhancement software. This revised logic
                            # first checks the process name against the app itself and the blacklist.
                            # Then, it checks if the session is simply active and unmuted, which is
                            # more reliable, though potentially less precise (more false positives).
                            # This brings Windows behavior more in line with other platforms.
                            process_name_full = session.Process.name()
                            process_name_lower = process_name_full.lower()
                            if process_name_lower == self.current_process_name or process_name_lower in self.audio_proc_blacklist: continue
                            
                            if not session.SimpleAudioVolume.GetMute():
                                is_external_audio_active = True
                                active_sources.append(process_name_full)
                        except (COMError, AttributeError, ValueError):
                            # Some sessions may not have all properties (e.g., Process.name(), GetMute()).
                            # It's safe to just skip them.
                            pass
                except Exception as e:
                    logger.error(f"Unhandled exception in Windows audio session check: {e}", exc_info=True)
                    self.stop_auto_pause_event.wait(5)
                    continue
                if is_external_audio_active != last_state:
                    logger.info(f"External audio {'DETECTED' if is_external_audio_active else 'stopped'}. Sources: {list(set(active_sources))}")
                    last_state = is_external_audio_active
                    payload = {'isActive': is_external_audio_active, 'sources': list(set(active_sources))}
                    try:
                        self.window_manager.broadcast_js(f"window.setExternalAudioState({json.dumps(payload)})")
                    except Exception as e:
                        logger.error(f"Could not communicate with frontend to set audio state: {e}")
                        break
                self.stop_auto_pause_event.wait(1)
        finally:
            try:
                self.window_manager.broadcast_js(f"window.setExternalAudioState({json.dumps({'isActive': False, 'sources': []})})")
            except: pass
            CoUninitialize()
            logger.info("External audio monitor thread for Windows stopped.")

    def _monitor_audio_linux(self):
        logger.info("Starting external audio monitor thread for Linux (pactl)...")
        last_state = False
        binary_re, name_re = re.compile(r'^\s*application\.process\.binary = "(.*?)"', re.M), re.compile(r'^\s*application\.name = "(.*?)"', re.M)
        try:
            while not self.stop_auto_pause_event.is_set():
                is_external_audio_active, active_sources = False, []
                try:
                    result = subprocess.run(['pactl', 'list', 'sink-inputs'], capture_output=True, text=True, check=True, timeout=3)
                    for block in result.stdout.split('Sink Input #'):
                        if not block.strip(): continue
                        if ('State: RUNNING' in block and 'Mute: yes' not in block and 'Corked: yes' not in block):
                            binary_match = binary_re.search(block)
                            if binary_match:
                                app_binary = binary_match.group(1).lower()
                                if app_binary == self.current_process_name or app_binary in self.audio_proc_blacklist: continue
                                is_external_audio_active = True
                                name_match = name_re.search(block)
                                app_name = name_match.group(1) if name_match else app_binary
                                if app_name not in active_sources: active_sources.append(app_name)
                except FileNotFoundError:
                    logger.warning("`pactl` command not found. Auto-pause on Linux requires PulseAudio or PipeWire with the pactl utility.")
                    break
                except (subprocess.TimeoutExpired, subprocess.CalledProcessError): pass
                except Exception as e:
                    logger.error(f"Unhandled exception in Linux audio check: {e}", exc_info=True)
                    self.stop_auto_pause_event.wait(5)
                    continue
                if is_external_audio_active != last_state:
                    logger.info(f"External audio {'DETECTED' if is_external_audio_active else 'stopped'}. Sources: {active_sources}")
                    last_state = is_external_audio_active
                    payload = {'isActive': is_external_audio_active, 'sources': active_sources}
                    try:
                        self.window_manager.broadcast_js(f"window.setExternalAudioState({json.dumps(payload)})")
                    except Exception as e:
                        logger.error(f"Could not communicate with frontend to set audio state: {e}")
                        break
                self.stop_auto_pause_event.wait(2)
        finally:
            try:
                self.window_manager.broadcast_js(f"window.setExternalAudioState({json.dumps({'isActive': False, 'sources': []})})")
            except: pass
            logger.info("External audio monitor thread for Linux stopped.")

    def _monitor_audio_macos(self):
        logger.info("Starting external audio monitor thread for macOS (system_profiler)...")
        last_state = False
        try:
            while not self.stop_auto_pause_event.is_set():
                is_external_audio_active, active_sources = False, []
                try:
                    result = subprocess.run(['system_profiler', 'SPAudioDataType', '-json'], capture_output=True, text=True, check=True, timeout=5)
                    audio_data = json.loads(result.stdout)
                    if 'SPAudioDataType' in audio_data:
                        for device in audio_data['SPAudioDataType']:
                            if '_items' in device:
                                for item in device['_items']:
                                    if item.get('spaudio_output_running') == 'Yes':
                                        is_external_audio_active = True; break
                                if is_external_audio_active: break
                    if is_external_audio_active: active_sources = ["Another Application"]
                except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError, KeyError): pass
                except Exception as e:
                    logger.error(f"Unhandled exception in macOS audio check: {e}", exc_info=True)
                    self.stop_auto_pause_event.wait(5)
                    continue
                if is_external_audio_active != last_state:
                    logger.info(f"External audio {'DETECTED' if is_external_audio_active else 'stopped'}.")
                    last_state = is_external_audio_active
                    payload = {'isActive': is_external_audio_active, 'sources': active_sources}
                    try:
                        self.window_manager.broadcast_js(f"window.setExternalAudioState({json.dumps(payload)})")
                    except Exception as e:
                        logger.error(f"Could not communicate with frontend to set audio state: {e}")
                        break
                self.stop_auto_pause_event.wait(3)
        finally:
            try:
                self.window_manager.broadcast_js(f"window.setExternalAudioState({json.dumps({'isActive': False, 'sources': []})})")
            except: pass
            logger.info("External audio monitor thread for macOS stopped.")

    def start_auto_pause_monitor(self):
        if self.auto_pause_thread is None or not self.auto_pause_thread.is_alive():
            logger.info("Activating auto-pause monitor.")
            self.stop_auto_pause_event.clear()
            self.auto_pause_thread = threading.Thread(target=self._monitor_external_audio, daemon=True)
            self.auto_pause_thread.start()

    def stop_auto_pause_monitor(self):
        if self.auto_pause_thread and self.auto_pause_thread.is_alive():
            logger.info("Deactivating auto-pause monitor.")
            self.stop_auto_pause_event.set()

    def set_auto_pause_enabled(self, enable):
        try:
            response = {'status': 'success'}
            if enable:
                if sys.platform == "win32" and not PYCAW_AVAILABLE:
                    self.config['autoPauseOnExternalAudio'] = False
                    config_handler.save_config(self.config)
                    return {'status': 'error', 'message': "pycaw library not found. Auto-pause on Windows requires it."}
                if sys.platform == "darwin": response = {'status': 'warning', 'message': 'Auto-pause on macOS has a 3-5 second delay and cannot identify the app playing audio.'}
                elif sys.platform.startswith("linux"): response = {'status': 'warning', 'message': 'Auto-pause on Linux is experimental and may not work with all audio setups.'}
            self.config['autoPauseOnExternalAudio'] = bool(enable)
            config_handler.save_config(self.config)
            if enable: self.start_auto_pause_monitor()
            else: self.stop_auto_pause_monitor()
            logger.info(f"Auto-pause feature set to enabled: {enable}")
            return response
        except Exception as e:
            logger.error("Error setting auto-pause enabled state: %s", e, exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def save_audio_proc_blacklist(self, blacklist):
        """Saves the user-defined audio process blacklist."""
        try:
            if not isinstance(blacklist, list) or not all(isinstance(i, str) for i in blacklist):
                return {'status': 'error', 'message': 'Invalid data format for blacklist.'}
            self.config['autoPauseAudioProcBlacklist'] = blacklist
            config_handler.save_config(self.config)
            self.audio_proc_blacklist = [p.lower() for p in blacklist]
            logger.info(f"Audio process blacklist updated: {blacklist}")
            return {'status': 'success'}
        except Exception as e:
            logger.error("Error saving audio process blacklist: %s", e, exc_info=True)
            return {'status': 'error', 'message': str(e)}
            
    # --- Discord Rich Presence ---
    def _connect_to_discord(self):
        """Worker function to connect to Discord RPC. Runs in a separate thread."""
        try:
            rpc_instance = pypresence.Presence(DISCORD_CLIENT_ID)
            rpc_instance.connect()  # This is the blocking call.
            self.rpc = rpc_instance # Assign to self.rpc only on successful connection.
            logger.info("Discord Rich Presence connected.")
        except Exception as e:
            logger.warning(f"Could not connect to Discord Rich Presence: {e}")
            self.rpc = None

    def start_rich_presence(self):
        """Starts the Discord Rich Presence connection in a background thread."""
        if not PYPRESENCE_AVAILABLE:
            return
        # Check if already connected or a connection attempt is in progress.
        if self.rpc or (self.rpc_thread and self.rpc_thread.is_alive()):
            return

        logger.info("Attempting to connect to Discord Rich Presence...")
        self.rpc_thread = threading.Thread(target=self._connect_to_discord, daemon=True)
        self.rpc_thread.start()

    def stop_rich_presence(self):
        if self.rpc:
            try:
                self.rpc.close()
                logger.info("Discord Rich Presence disconnected.")
            except Exception as e: logger.warning(f"Error while closing Discord Rich Presence: {e}")
            finally: self.rpc = None

    def set_discord_presence_enabled(self, enable):
        try:
            if enable and not PYPRESENCE_AVAILABLE:
                self.config['discordRichPresence'] = False
                config_handler.save_config(self.config)
                return {'status': 'error', 'message': "pypresence library not found. Install it with: pip install pypresence"}
            self.config['discordRichPresence'] = bool(enable)
            config_handler.save_config(self.config)
            if enable: self.start_rich_presence()
            else: self.stop_rich_presence()
            logger.info(f"Discord Rich Presence set to enabled: {enable}")
            return {'status': 'success'}
        except Exception as e:
            logger.error("Error setting Discord Rich Presence state: %s", e, exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def update_rich_presence(self, data):
        if not self.rpc and self.config.get('discordRichPresence'): self.start_rich_presence()
        if not self.rpc: return
        try:
            if data: self.rpc.update(**data)
            else: self.rpc.clear()
        except pypresence.exceptions.PipeClosed:
            logger.warning("Discord pipe closed. Assuming Discord was closed.")
            self.stop_rich_presence()
        except Exception as e:
            logger.error(f"Failed to update Discord Rich Presence: {e}", exc_info=True)
            self.stop_rich_presence()