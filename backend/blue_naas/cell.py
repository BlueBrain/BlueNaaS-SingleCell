'''Cell module.'''
import os
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from numpy.lib.recfunctions import join_by, merge_arrays

from blue_naas.settings import L
from blue_naas.util import (NeuronOutput, compile_mechanisms, get_sec_name, get_sections, get_syns,
                            locate_model, set_sec_dendrogram)

# for the simulation time interval not more than voltage samples from all segments
MAX_SAMPLES = 300

TIME = 'time'


class Cell():
    '''Neuron model.'''

    def __init__(self, model_id):
        self._model_id = model_id
        self._model_path = None
        self._template_name = None
        self._recordings = {}
        self._all_sec_array = []
        self._all_sec_map = {}
        self._dendrogram = {}
        self._synapses = {}
        self._neuron_output = None
        self._nrn = None
        self._init_params = {}
        self.template = None
        self.delta_t = None

    def _prepare_neuron_output_file(self):
        '''Redirect std output to fifo file.'''
        neuron_output_file_name = '/opt/blue-naas/tmp/neuron_output'

        Path(neuron_output_file_name).unlink(missing_ok=True)

        os.mkfifo(neuron_output_file_name)
        neuron_output_fd = os.open(neuron_output_file_name, os.O_RDONLY | os.O_NONBLOCK)
        self._neuron_output = NeuronOutput(neuron_output_fd)

        neuron_output_fd_w = os.open(neuron_output_file_name, os.O_WRONLY)
        # if you are running in docker with ipdb breakpoint -> comment the following 2 lines,
        # to be able to stop at the breakpoint
        os.dup2(neuron_output_fd_w, sys.stdout.fileno())
        os.dup2(neuron_output_fd_w, sys.stderr.fileno())

    def _topology_children(self, sec, topology):
        children = topology['children']
        level = topology['level']
        for child_sec in sec.children():
            child_topology = {'id': get_sec_name(self._template_name, child_sec),
                              'children': [],
                              'level': level + 1}
            children.append(child_topology)
            self._topology_children(child_sec, child_topology)
        return topology

    def _load_by_model_id(self, model_id):
        # pylint: disable=too-many-statements
        os.chdir('/opt/blue-naas')  # in dev, if tornado reloads, cwd will not be root for nmc

        self._model_path = locate_model(model_id)
        compile_mechanisms(self._model_path)

        # make sure x86_64 is in current dir before importing neuron
        os.chdir(self._model_path)

        # load the model
        bsp_template = self._model_path / 'checkpoints' / 'cell.hoc'
        nmc_template = self._model_path / 'template.hoc'
        new_template = self._model_path / 'cell.hoc'

        self._prepare_neuron_output_file()

        # hoc base model,import NEURON after we compile the mechanisms
        import neuron  # pylint: disable=import-outside-toplevel
        self._nrn = neuron

        neuron.h.load_file('stdlib.hoc')
        neuron.h.load_file('stdrun.hoc')
        neuron.h.load_file('import3d.hoc')

        if bsp_template.exists():
            try:
                with self._neuron_output:
                    cmd = ['awk', '/^begintemplate / { print $2 }', str(bsp_template)]
                    self._template_name = subprocess.check_output(cmd).decode().strip()
                    neuron.h.load_file(str(self._model_path / 'checkpoints' / 'cell.hoc'))
                    template = getattr(neuron.h, self._template_name)
                    self.template = template(str(self._model_path / 'morphology'))
            except Exception as ex:
                raise Exception(self.get_neuron_output()) from ex

        elif nmc_template.exists():
            try:
                with self._neuron_output:
                    cmd = ['awk', '/^begintemplate / { print $2 }', str(nmc_template)]
                    self._template_name = subprocess.check_output(cmd).decode().strip()
                    neuron.h.load_file(str(nmc_template))
                    template = getattr(neuron.h, self._template_name)
                    self.template = template(0)

                    holding_current = 0
                    current_amps = Path('current_amps.dat')
                    if current_amps.is_file():
                        # nmc-portal models use these defaults
                        # read holding current: the first value, cwd is current model for nmc
                        data = current_amps.read_text(encoding='utf8')
                        holding_current = [float(i.strip()) for i in data.split(' ')][0]

                    self._init_params = {'hypamp': holding_current, 'vinit': -65, 'dt': 0.025}
            except Exception as ex:
                raise Exception(self.get_neuron_output()) from ex

        elif new_template.exists():
            try:
                with self._neuron_output:
                    cmd = ['awk', '/^begintemplate / { print $2 }', str(new_template)]
                    self._template_name = subprocess.check_output(cmd).decode().strip()
                    neuron.h.load_file(str(new_template))
                    template = getattr(neuron.h, self._template_name)
                    self.template = template(1,
                                             str(next((self._model_path / 'morphology').iterdir())))
            except Exception as ex:
                raise Exception(self.get_neuron_output()) from ex

        else:
            raise Exception("HOC file not found! Expecting '/checkpoints/cell.hoc' for "
                            "BSP model format or `/template.hoc`!")

    def _load_from_path(self, hoc_path, morph_path):
        os.chdir(os.path.dirname(hoc_path))

        cmd = ['nrnivmodl']
        compilation_output = subprocess.check_output(cmd)
        L.debug(compilation_output.decode())

        # import NEURON after we compile the mechanisms
        import neuron  # pylint: disable=import-outside-toplevel
        self._nrn = neuron

        self._prepare_neuron_output_file()

        neuron.h.load_file('stdlib.hoc')
        neuron.h.load_file('stdrun.hoc')
        neuron.h.load_file('import3d.hoc')

        # load the model
        hoc_name = os.path.basename(hoc_path)
        morph_name = os.path.basename(morph_path)

        with self._neuron_output:
            cmd = ['awk', '/^begintemplate / { print $2 }', hoc_name]
            self._template_name = subprocess.check_output(cmd).decode().strip()
            neuron.h.load_file(hoc_name)
            template = getattr(neuron.h, self._template_name)
            if any(mod.startswith('CaDynamics') for mod in os.listdir('.')):
                self.template = template(1, '.', morph_name)
            else:
                self.template = template('.', morph_name)

    def get_init_params(self):
        '''Get initial parameters.'''
        return getattr(self, '_init_params', None)

    def get_neuron_output(self):
        '''Get NEURON output.'''
        return str(self._neuron_output)

    @property
    def model_id(self):
        '''Get model id.'''
        return self._model_id

    def get_cell_morph(self):
        '''Get neuron morphology.'''
        return self._all_sec_map

    def get_dendrogram(self):
        '''Get dendrogram.'''
        return self._dendrogram

    def get_synapses(self):
        '''Get synapses.'''
        return self._synapses

    def get_topology(self):
        '''Get topology.'''
        topology_root = {'id': get_sec_name(self._template_name, self.template.soma[0]),
                         'children': [],
                         'level': 0}
        return [self._topology_children(self.template.soma[0], topology_root)]

    def get_sec_info(self, sec_name):
        '''Get section info from NEURON.'''
        L.debug(sec_name)
        with self._neuron_output:
            self._nrn.h.psection(sec=self._all_sec_array[self._all_sec_map[sec_name]['index']])
        return {'txt': self.get_neuron_output()}

    def get_iclamp(self):
        '''Get IClamp location, return the name of the section where IClamp is attached.'''
        self._iclamp.get_loc()
        name = get_sec_name(self._template_name, self._nrn.h.cas())
        self._nrn.h.pop_section()
        return name

    def set_iclamp(self, sec_name):
        '''Move IClamp to the middle of the section.'''
        self._iclamp.loc(0.5, sec=self._all_sec_array[self._all_sec_map[sec_name]['index']])

    def _send_voltage(self, send_message_fn):
        '''Send voltage trace message.'''
        voltages = [self._nrn.h.t]
        for sec in self._all_sec_array:
            for _, seg in enumerate(sec):
                voltages.append(seg.v)

        send_message_fn('sim_voltage', voltages)

    def start_simulation(self, params, send_message_fn, call_later_fn):
        '''Initialize the simulation and recordings.'''
        try:
            with self._neuron_output:
                L.debug('params %s', params)

                v = self._nrn.h.Vector()
                # pylint: disable=protected-access
                v.record(self._nrn.h._ref_t, sec=self.template.soma[0])

                self._recordings = {}
                self._recordings[TIME] = v

                for seg_name in params['recordFrom']:
                    sec_name, seg_str = seg_name.split('_')
                    seg_idx = int(seg_str)
                    sec_data = self._all_sec_map[sec_name]
                    sec = self._all_sec_array[sec_data['index']]
                    segx = sec_data['segx'][seg_idx]

                    v = self._nrn.h.Vector()
                    v.record(sec(segx)._ref_v, sec=sec)

                    self._recordings[seg_name] = v

                tstop = params['tstop']
                self._nrn.h.tstop = tstop
                self._iclamp.amp = params['amp']
                self._iclamp.delay = params['delay']
                self._iclamp.dur = params['dur']
                dt = params['dt']

                # holding current
                self._hyp_iclamp.delay = 0
                self._hyp_iclamp.dur = tstop
                self._hyp_iclamp.amp = params['hypamp']

                self.delta_t = tstop / MAX_SAMPLES
                L.debug('delta_t: %s', self.delta_t)

                if dt is None:
                    L.debug('sim with variable timestamp')
                    self._nrn.h.cvode_active(1)
                else:
                    L.debug('sim with timestamp %sms', dt)
                    self._nrn.h.cvode_active(0)
                    self._nrn.h.dt = dt
                    self._nrn.h.steps_per_ms = 1.0 / dt

                self._nrn.h.celsius = params['celsius']
                self._nrn.h.stoprun = 0
                self._nrn.h.stdinit()
                self._nrn.h.finitialize(params['vinit'])

                self._send_voltage(send_message_fn)
        except Exception:  # pylint: disable=broad-except
            send_message_fn('error', {'msg': 'Start-Simulation error',
                                      'raw': self.get_neuron_output()})
        else:
            call_later_fn(0, self.step_simulation, send_message_fn, call_later_fn)

    def step_simulation(self, send_message_fn, call_later_fn):
        '''Execute one step of the simulation.

        Run additional steps until we exceed the delta_t
        then respond with the voltage trace across all segments
        and schedule next time interval for the simulation.
        When simulation is done send all recorded traces.
        '''
        try:
            with self._neuron_output:
                t_stop = self._nrn.h.t + self.delta_t

                self._nrn.h.step()

                while (self._nrn.h.t < t_stop
                        and self._nrn.h.stoprun == 0
                        and self._nrn.h.t < self._nrn.h.tstop):

                    self._nrn.h.step()

                self._send_voltage(send_message_fn)

                if self._nrn.h.stoprun == 1 or self._nrn.h.tstop <= self._nrn.h.t:
                    # simulation ended
                    # convert map of the recorded vectors to list of panda csv like with header
                    recordings = merge_arrays([v.as_numpy().view(dtype=[(k, 'd')])
                                               for k, v in self._recordings.items()])

                    # load experimental traces in case they are present
                    trace_file = self._model_path / 'traces.dat'
                    if trace_file.is_file():
                        traces = np.genfromtxt(str(trace_file), delimiter=',',
                                               names=True, deletechars='')
                        recordings = join_by('time', traces, recordings, 'outer')

                    send_message_fn('sim_done', [recordings.dtype.names] + recordings.tolist())
                else:
                    # continue next simulation interval and give tornado a chance to process msgs
                    call_later_fn(0, self.step_simulation, send_message_fn, call_later_fn)
        except Exception:  # pylint: disable=broad-except
            send_message_fn('error', {'msg': 'Step-Simulation error',
                                      'raw': self.get_neuron_output()})

    def stop_simulation(self):
        '''Stop simulation.'''
        L.debug('stop simulation')
        self._nrn.h.stoprun = 1


class HocCell(Cell):
    '''Cell model with hoc.'''

    def __init__(self, model_id, hoc_path=None, morph_path=None):
        super().__init__(model_id)

        if hoc_path is None:
            self._load_by_model_id(model_id)
        else:
            self._load_from_path(hoc_path, morph_path)

        L.debug('Loading model output: %s', self.get_neuron_output())

        self._nrn.h.define_shape()

        self._all_sec_array, self._all_sec_map = get_sections(self._nrn, self._template_name)
        set_sec_dendrogram(self._template_name, self.template.soma[0], self._dendrogram)
        path = self._model_path / 'synapses_meta.json'
        if path.is_file():
            self._synapses = get_syns(self._nrn, path, self._template_name, self._all_sec_map)

        self._iclamp = self._nrn.h.IClamp(0.5, sec=self.template.soma[0])

        # setup holding current
        self._hyp_iclamp = self._nrn.h.IClamp(0.5, sec=self.template.soma[0])


class PythonCell(Cell):
    '''Cell model with python.'''

    def _evaluate_dict(self, current_ref, d, func_calls):
        for param_name, param_value in d.items():
            if param_name == "FUNCTIONS":
                for f_call in (param_value if isinstance(param_value, list) else [param_value]):
                    ind = f_call.find("(")
                    f_call_name = f_call[:ind]
                    f_call_args = f_call[ind:]
                    func_calls.append([getattr(current_ref, f_call_name), f_call_args])
            elif isinstance(param_value, dict):
                match = re.search(r'(\[(\d+)\])+', param_name)
                if match:
                    attr_name = param_name[:match.start()]
                    attr_index = param_name[match.start():match.end()]
                    ref = getattr(current_ref, attr_name)
                    for m in re.finditer(r'\[(\d+)\]', attr_index):
                        ref = ref[int(m.group(1))]
                else:
                    ref = getattr(current_ref, param_name)
                self._evaluate_dict(ref, param_value, func_calls)
            else:
                setattr(current_ref, param_name, param_value)

    def _apply_parameters(self, parameters):
        func_calls = []
        for key, value in parameters.items():
            if isinstance(value, (dict, list)):
                self._evaluate_dict(self._model, {key: value}, func_calls)
            else:
                setattr(self._nrn.h, key, value)
        if func_calls:
            for f_call in func_calls:
                eval(f'f_call[0]{f_call[1]}')  # pylint: disable=eval-used

    def __init__(self, model_id, model_path):
        super().__init__(model_id)

        # in dev, if tornado reloads, cwd will not be root for nmc
        os.chdir(str(Path('/opt/blue-naas') / model_path))

        compile_mechanisms('.', no_throw=True)

        self._prepare_neuron_output_file()

        sys.path.append(os.getcwd())
        try:
            with self._neuron_output:
                # pylint: disable=import-error,import-outside-toplevel
                import neuron
                import neuronservice
                self._nrn = neuron
                self._model = neuronservice.MODEL
        except Exception as ex:
            raise Exception(self.get_neuron_output()) from ex

    def set_params(self, params):
        '''Set model parameters.'''
        try:
            with self._neuron_output:
                L.debug('Applying model params: %s', params)
                self._apply_parameters(params)
        except Exception:
            L.exception('NEURON: %s', self.get_neuron_output())
            raise

    def run_simulation(self, record_from):
        '''Run simulation.'''
        try:
            with self._neuron_output:
                L.debug('Running sim, recording from: %s', record_from)
                self._nrn.h.run()
                return {vec_label: getattr(self._model, vec_name).as_numpy()
                        for vec_label, vec_name in record_from.items()}
        except Exception:
            L.exception('NEURON: %s', self.get_neuron_output())
            raise
