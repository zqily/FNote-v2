# This file makes the 'api' directory a Python package.
import logging

# Set up a null handler to avoid "No handler found" warnings
# if the library is imported before logging is configured.
logging.getLogger(__name__).addHandler(logging.NullHandler())