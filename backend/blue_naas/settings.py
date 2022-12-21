'''Common settings for the app.'''
import logging
import os

STDOUT_FD_W = os.open('/dev/stdout', os.O_WRONLY | os.O_NOCTTY)
L = logging.getLogger('blue_naas')
L.propagate = False
_STREAM_HANDLER = logging.StreamHandler(
    open(STDOUT_FD_W, 'w', encoding='utf8'))  # pylint: disable=consider-using-with
_STREAM_HANDLER.setFormatter(logging.Formatter(logging.BASIC_FORMAT))
L.addHandler(_STREAM_HANDLER)
DEBUG = os.getenv('DEBUG') is not None
if DEBUG:
    L.setLevel(logging.DEBUG)
else:
    L.setLevel(logging.INFO)

ALLOWED_ORIGIN = os.getenv('ALLOWED_ORIGIN', 'http://localhost:8080')
ALLOWED_IP = os.getenv('ALLOWED_IP', '')
