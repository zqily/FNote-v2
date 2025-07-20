import logging
import os
import sys
from datetime import datetime
from python_utils import APP_DATA_DIR

# New log directory
LOG_DIR = os.path.join(APP_DATA_DIR, 'logs')
MAX_LOG_FILES = 50

def setup_logging():
    """Configures logging for the entire application to a timestamped file and the console."""
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        
        # --- Log file rotation based on file count ---
        log_files = sorted(
            [os.path.join(LOG_DIR, f) for f in os.listdir(LOG_DIR) if f.endswith('.log')],
            key=os.path.getmtime
        )
        while len(log_files) >= MAX_LOG_FILES:
            oldest_log = log_files.pop(0)
            os.remove(oldest_log)
            
    except OSError as e:
        # Cannot use logger yet, so print. This is a critical failure.
        print(f"FATAL: Could not create log directory or manage log files: {e}")

    # --- New timestamped log file for the current session ---
    timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    log_file_path = os.path.join(LOG_DIR, f'fnote_{timestamp}.log')

    log_format = logging.Formatter(
        '%(asctime)s - %(levelname)s - [%(name)s:%(lineno)d] - %(message)s'
    )

    # File Handler for the new log file
    try:
        file_handler = logging.FileHandler(log_file_path, encoding='utf-8')
        file_handler.setFormatter(log_format)
        file_handler.setLevel(logging.INFO)
    except Exception as e:
        print(f"FATAL: Could not create log file handler for '{log_file_path}': {e}")
        # Proceed without file logging if it fails.

    # Console Handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(log_format)
    console_handler.setLevel(logging.INFO)

    # Get the root logger and set up handlers
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    
    # Clear any existing handlers to prevent duplicates if setup_logging is called multiple times
    if root_logger.hasHandlers():
        root_logger.handlers.clear()
        
    root_logger.addHandler(console_handler)
    
    # Add file handler only if it was successfully created
    if 'file_handler' in locals():
        root_logger.addHandler(file_handler)

    logging.info("="*20 + " FNote Logging Started " + "="*20)
    logging.info(f"Log file for this session: {log_file_path}")