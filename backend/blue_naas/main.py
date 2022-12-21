'''Main app module.'''
import io
import itertools
import json
import os
import sys
from pathlib import Path
from random import choice
from string import ascii_uppercase
from urllib.parse import urlunsplit
from zipfile import ZipFile

import requests
import tornado.ioloop
import tornado.web
import tornado.websocket

from blue_naas import settings
from blue_naas.cell import HocCell, PythonCell
from blue_naas.settings import L
from blue_naas.util import NumpyAwareJSONEncoder, is_python_model, locate_model

CLIENT_ID = None
CELL = None


def _load_from_url(url):
    try:
        zip_url = urlunsplit(('https',
                              'object.cscs.ch',
                              'v1/AUTH_c0a333ecf7c045809321ce9d9ecdfdea/' + url,
                              None,
                              None))
        L.debug('downloading emodel from url: %s', zip_url)
        response = requests.get(zip_url, stream=True, timeout=10)
        try:
            response.raise_for_status()
            chunks = response.iter_content(chunk_size=1024)
            with ZipFile(io.BytesIO(bytes(itertools.chain.from_iterable(chunks))), 'r') as zf:
                zf.extractall('/opt/blue-naas/tmp')
        finally:
            response.close()

        # first subfolder which doesn't start with __ (zip made on Mac contains __MACOSX)
        model_id = next((subfolder for subfolder in next(os.walk('/opt/blue-naas/tmp'), ('', []))[1]
                         if not subfolder.startswith('__')), None)
        return model_id

    except Exception:
        L.exception('Model download failed!')
        raise


def ready():
    '''Signal that the container is ready to accept requests by creating the "ready" file.'''
    Path('/opt/blue-naas/probes/ready').touch()


def not_ready():
    '''Signal that the container is not ready to accept requests by removing the "ready" file.'''
    Path('/opt/blue-naas/probes/ready').unlink(missing_ok=True)


def alive():
    '''Signal that the container is alive by creating the "alive" file.'''
    Path('/opt/blue-naas/probes/alive').touch()


def not_alive():
    '''Signal that the container is not alive by removing the "alive" file.'''
    Path('/opt/blue-naas/probes/alive').unlink(missing_ok=True)


def stop():
    '''Stop and eventually restart the container.'''
    tornado.ioloop.IOLoop.instance().stop()
    not_ready()
    not_alive()


def check_allowed(origin):
    '''Check if origin is allowed.'''
    L.debug('Origin: %s', origin)
    return any(origin.startswith(allowed.strip()) for allowed in settings.ALLOWED_ORIGIN.split(','))


def check_allowed_ip(ip):
    '''Check if ip is allowed.'''
    if not ip:
        return False
    return any(ip.startswith(allowed.strip()) for allowed in settings.ALLOWED_IP.split(','))


class WSHandler(tornado.websocket.WebSocketHandler):
    '''Handle web socket connections.'''

    # pylint: disable=abstract-method
    connection_count = 0

    def _inc_connection_count(self):
        self.connection_count += 1

    def _dec_connection_count(self):
        self.connection_count -= 1
        if self.connection_count == 0:
            stop()

    def check_origin(self, origin):
        is_allowed = check_allowed(origin)
        if not is_allowed:
            client_ip = self.request.headers.get('Client-Ip', '')
            L.debug('Client-ip: %s', client_ip)
            is_allowed = check_allowed_ip(client_ip)
            if is_allowed:
                L.debug('Allowing for Client-Ip: %s', client_ip)
        return is_allowed

    def open(self, *args, **kwargs):
        '''Open websocket connection.'''
        global CLIENT_ID  # pylint: disable=global-statement
        L.debug('Open WS, current client id:%s', CLIENT_ID)
        self._inc_connection_count()

        if CLIENT_ID:  # this pod is reserved by some client through init endpoint
            L.error('Client id already set, reserved pod!')
            self._dec_connection_count()
            self.close(503, 'WebSocket connection arrived at the reserved pod!')
        else:
            CLIENT_ID = ''.join(choice(ascii_uppercase) for i in range(10))
        L.debug('Open WS, client id:%s', CLIENT_ID)
        not_ready()

    def on_message(self, message):
        '''Handle websocket message.'''
        # pylint: disable=too-many-statements,too-many-branches
        msg = json.loads(message)
        L.debug('WS incoming message: %s', msg)

        cmd = msg['cmd']

        try:
            if cmd in ['set_model', 'set_url']:
                if cmd == 'set_url':
                    url = msg.get('data')
                    model_id = _load_from_url(url)
                else:
                    model_id = msg.get('data')

                if model_id is None:
                    raise Exception('Missing model id')

                global CELL  # pylint: disable=global-statement
                if CELL is None:
                    L.debug('loading model %s', model_id)
                    model_path = locate_model(model_id)
                    if is_python_model(model_path):
                        CELL = PythonCell(model_id, model_path=model_path)
                    else:
                        CELL = HocCell(model_id)

                elif CELL.model_id != model_id:
                    L.debug('Trying to load different model, '
                            'current: %s, new: %s, discarding the pod', CELL.model_id, model_id)
                    stop()
                    return

            elif cmd == 'set_params':
                CELL.set_params(msg.get('data'))

            elif cmd == 'run_simulation':
                result = CELL.run_simulation(msg.get('data'))
                self.send_message('simulation_done', result)

            elif cmd == 'get_ui_data':
                init_params = CELL.get_init_params()
                if init_params:
                    self.send_message('init_params', init_params)
                self.send_message('morphology', CELL.get_cell_morph())
                self.send_message('topology', CELL.get_topology())
                self.send_message('dendrogram', CELL.get_dendrogram())
                self.send_message('synapses', CELL.get_synapses())
                self.send_message('iclamp', CELL.get_iclamp())

            elif cmd == 'get_sec_info':
                self.send_message('sec_info', CELL.get_sec_info(msg['data']))

            elif cmd == 'set_iclamp':
                CELL.set_iclamp(msg['data'])
                self.send_message('iclamp', CELL.get_iclamp())

            elif cmd == 'start_simulation':
                call_later_fn = tornado.ioloop.IOLoop.current().call_later
                call_later_fn(0, CELL.start_simulation, msg['data'], self.send_message,
                              call_later_fn)

            elif cmd == 'stop_simulation':
                CELL.stop_simulation()

            else:
                raise Exception('Unknown message')

        except Exception:  # pylint: disable=broad-except
            L.exception('Unexpected error')
            self.send_message('error', str(sys.exc_info()[1]))

    def on_close(self):
        L.debug('ws client disconnected')
        self._dec_connection_count()

    def send_message(self, cmd, data=None):
        '''Send websocket message.'''
        msg = {'cmd': cmd, 'data': data}
        L.debug('WS outgoing message: %.100s', msg)
        payload = json.dumps(msg, cls=NumpyAwareJSONEncoder)
        self.write_message(payload)

        if cmd == 'error':
            stop()


if __name__ == '__main__':
    app = tornado.web.Application([
        (r'/ws', WSHandler),
    ], debug=settings.DEBUG)
    L.debug('autoreload: %s', app.settings.get('autoreload'))
    app.listen(8000, xheaders=True)

    ready()

    try:
        tornado.ioloop.IOLoop.current().start()
    finally:
        not_alive()
