'''Util.'''
import errno
import json
import os
import re
import subprocess
import tarfile
from pathlib import Path

import numpy as np

from blue_naas.settings import STDOUT_FD_W, L

PADDING = 2.0


class NumpyAwareJSONEncoder(json.JSONEncoder):
    '''Serialize numpy to json.'''

    def default(self, o):
        '''Handle numpy lists.'''
        if isinstance(o, np.ndarray) and o.ndim == 1:
            return o.tolist()
        return json.JSONEncoder.default(self, o)


class NeuronOutput():
    '''Capture output from neuron stdout.'''

    BUFFER_SIZE = 2**20

    def _drain_fd(self):
        result = ''
        while True:
            try:
                buf = os.read(self._fd, self.BUFFER_SIZE)
                if not buf:
                    return result  # EOF
                result += buf.decode()
                os.write(STDOUT_FD_W, buf)
            except OSError as err:
                if err.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    return result  # no data
                else:
                    raise  # something else has happened -- better reraise

    def __init__(self, file_desc):
        self._fd = file_desc
        self._result = None

    def __enter__(self):
        '''Start NEURON output capture.'''
        self._drain_fd()

    def __exit__(self, *args):
        '''Stop NEURON output capture.'''
        self._result = self._drain_fd()

    def __str__(self):
        '''Get NEURON output.'''
        return self._result


def is_spine(sec_name):
    '''Check if "spine" suffix is present in section name.'''
    return 'spine' in sec_name


def _extract_model(model_path):
    '''Extract xz model to tmp folder.'''
    with tarfile.open(model_path) as f:
        f.extractall('/opt/blue-naas/tmp')
    return next(Path('/opt/blue-naas/tmp').iterdir())


def locate_model(model_id):
    '''Locate model according to the priorities.

    First will look-up in models folder, then in the tmp folder, where unzipped models are going.

    Returns:
        pathlib.Path: path for the model

    Raises:
        Exception: if model not found
    '''
    model_path = Path('/opt/blue-naas/models') / model_id
    if model_path.suffixes == ['.tar', '.xz']:
        return _extract_model(model_path)
    if model_path.exists():
        return model_path
    model_path = Path('/opt/blue-naas/tmp') / model_id  # model catalog models go in here
    if model_path.exists():
        return model_path
    raise Exception(f'Model id not found: {model_id}')


def is_python_model(model_path):
    '''Check if the model is python based.'''
    return Path(model_path, 'neuronservice.py').is_file()


def compile_mechanisms(model_path, no_throw=False):
    '''Compile model mechanisms.'''
    mech_path = Path(model_path) / 'mechanisms'
    if not mech_path.is_dir():
        if not no_throw:
            raise Exception("Folder not found! Expecting 'mechanisms' folder in the model!")
    else:
        cmd = ['nrnivmodl', 'mechanisms']
        compilation_output = subprocess.check_output(cmd, cwd=model_path)
        L.info(compilation_output.decode())


def get_sec_name(template_name, sec):
    '''Get section name.'''
    return sec.name().replace(template_name + '[0].', '')


def get_morph_data(nrn):
    '''Get 3d morphology points, for each section, align soma at center.'''
    x = []
    y = []
    z = []
    arc = []
    for sec in nrn.h.allsec():
        sec_point_count = int(nrn.h.n3d(sec=sec))

        x_ = np.empty(sec_point_count)
        y_ = np.empty(sec_point_count)
        z_ = np.empty(sec_point_count)
        arc_ = np.empty(sec_point_count)

        for i in range(sec_point_count):
            x_[i] = nrn.h.x3d(i, sec=sec)
            y_[i] = nrn.h.y3d(i, sec=sec)
            z_[i] = nrn.h.z3d(i, sec=sec)
            arc_[i] = nrn.h.arc3d(i, sec=sec)

        x.append(x_)
        y.append(y_)
        z.append(z_)
        arc.append(arc_)

    if len(x) > 1:  # more than only just a soma
        soma_mean = x[0].mean(), y[0].mean(), z[0].mean()
        for i, _ in enumerate(x):
            x[i] -= soma_mean[0]
            y[i] -= soma_mean[1]
            z[i] -= soma_mean[2]

    return x, y, z, arc


def get_sec_name_seg_idx(template_name, seg):
    '''Get section name from segment.'''
    name = seg.sec.name().replace(template_name + '[0].', '')
    seg_idx = int(np.fix(seg.sec.nseg * seg.x * 0.9999999))
    return name, seg_idx


def get_sections(nrn, template_name):
    '''Get section segment cylinders and spines.'''
    # pylint: disable=too-many-statements,too-many-locals
    all_sec_array = []
    all_sec_map = {}

    x, y, z, arc = get_morph_data(nrn)

    for sec_idx, sec in enumerate(nrn.h.allsec()):
        sec_name = get_sec_name(template_name, sec)
        sec_data = {'index': sec_idx}

        all_sec_map[sec_name] = sec_data
        all_sec_array.append(sec)

        sec_data['nseg'] = sec.nseg
        seg_x_delta = 0.5 / sec.nseg

        if len(arc[sec_idx]) > 0:
            length = arc[sec_idx] / sec.L

            seg_x = np.empty(sec.nseg)
            seg_diam = np.empty(sec.nseg)
            seg_length = np.empty(sec.nseg)
            for i, seg in enumerate(sec):
                seg_x[i] = seg.x
                seg_diam[i] = seg.diam
                seg_length[i] = sec.L / sec.nseg

            seg_x_start = seg_x - seg_x_delta
            seg_x_end = seg_x + seg_x_delta

            sec_data['xstart'] = np.interp(seg_x_start, length, x[sec_idx])
            sec_data['xend'] = np.interp(seg_x_end, length, x[sec_idx])
            sec_data['xcenter'] = (sec_data['xstart'] + sec_data['xend']) / 2.0
            sec_data['xdirection'] = sec_data['xend'] - sec_data['xstart']

            sec_data['ystart'] = np.interp(seg_x_start, length, y[sec_idx])
            sec_data['yend'] = np.interp(seg_x_end, length, y[sec_idx])
            sec_data['ycenter'] = (sec_data['ystart'] + sec_data['yend']) / 2.0
            sec_data['ydirection'] = sec_data['yend'] - sec_data['ystart']

            sec_data['zstart'] = np.interp(seg_x_start, length, z[sec_idx])
            sec_data['zend'] = np.interp(seg_x_end, length, z[sec_idx])
            sec_data['zcenter'] = (sec_data['zstart'] + sec_data['zend']) / 2.0
            sec_data['zdirection'] = sec_data['zend'] - sec_data['zstart']

            sec_data['segx'] = seg_x
            sec_data['diam'] = seg_diam
            sec_data['length'] = seg_length
            sec_data['distance'] = np.sqrt(sec_data['xdirection'] * sec_data['xdirection'] +
                                           sec_data['ydirection'] * sec_data['ydirection'] +
                                           sec_data['zdirection'] * sec_data['zdirection'])

            if is_spine(sec_name):  # spine location correction
                assert sec_data['nseg'] == 1, 'spine sections should have one segment'
                parent_seg = sec.parentseg()
                parent_sec_name, parent_seg_idx = get_sec_name_seg_idx(template_name, parent_seg)
                parent_sec = all_sec_map[parent_sec_name]
                if is_spine(parent_sec_name):
                    # another section in spine -> continue in the direction of the parent
                    dir_ = np.array([parent_sec['xdirection'][parent_seg_idx],
                                     parent_sec['ydirection'][parent_seg_idx],
                                     parent_sec['zdirection'][parent_seg_idx]])
                    dir_norm = dir_ / np.linalg.norm(dir_)
                    sec_data['xstart'][0] = parent_sec['xend'][parent_seg_idx]
                    sec_data['ystart'][0] = parent_sec['yend'][parent_seg_idx]
                    sec_data['zstart'][0] = parent_sec['zend'][parent_seg_idx]
                    spine_end = spine_start + dir_norm * sec_data['length'][0]
                    sec_data['xend'][0] = spine_end[0]
                    sec_data['yend'][0] = spine_end[1]
                    sec_data['zend'][0] = spine_end[2]
                else:
                    seg_x_step = 1 / parent_seg.sec.nseg
                    seg_x_offset_normalized = ((parent_seg.x - seg_x_step * parent_seg_idx)
                                               / seg_x_step)
                    parent_start = np.array([
                        parent_sec['xstart'][parent_seg_idx],
                        parent_sec['ystart'][parent_seg_idx],
                        parent_sec['zstart'][parent_seg_idx]])
                    parent_dir = np.array([
                        parent_sec['xdirection'][parent_seg_idx],
                        parent_sec['ydirection'][parent_seg_idx],
                        parent_sec['zdirection'][parent_seg_idx]])
                    parent_dir = parent_dir / np.linalg.norm(parent_dir)
                    pos_in_parent = parent_start + parent_dir * seg_x_offset_normalized
                    # choose random spin orientation orthogonal to the parent section
                    random = np.random.uniform(-1, 1, 3)
                    dir_ = np.cross(parent_dir, random)
                    dir_norm = dir_ / np.linalg.norm(dir_)
                    spine_start = (pos_in_parent +
                                   dir_norm * parent_sec['diam'][parent_seg_idx] / 2)
                    sec_data['xstart'][0] = spine_start[0]
                    sec_data['ystart'][0] = spine_start[1]
                    sec_data['zstart'][0] = spine_start[2]
                    spine_end = spine_start + dir_norm * sec_data['length'][0]
                    sec_data['xend'][0] = spine_end[0]
                    sec_data['yend'][0] = spine_end[1]
                    sec_data['zend'][0] = spine_end[2]

                sec_data['xdirection'][0] = sec_data['xend'][0] - sec_data['xstart'][0]
                sec_data['ydirection'][0] = sec_data['yend'][0] - sec_data['ystart'][0]
                sec_data['zdirection'][0] = sec_data['zend'][0] - sec_data['zstart'][0]
                sec_data['xcenter'] = (sec_data['xstart'] + sec_data['xend']) / 2.0
                sec_data['ycenter'] = (sec_data['ystart'] + sec_data['yend']) / 2.0
                sec_data['zcenter'] = (sec_data['zstart'] + sec_data['zend']) / 2.0

    return all_sec_array, all_sec_map


def set_sec_dendrogram(template_name, sec, data):
    '''Set section dendrogram into data dictionary.'''
    data['name'] = get_sec_name(template_name, sec)
    data['height'] = sec.L + sec.nseg * PADDING

    segments = []
    data['segments'] = segments

    max_seg_diam = 0
    for seg in sec:
        if seg.diam > max_seg_diam:
            max_seg_diam = seg.diam
        segments.append({'length': sec.L / sec.nseg, 'diam': seg.diam})
    data['width'] = max_seg_diam + PADDING * 2

    data['sections'] = []
    for child_sec in sec.children():
        child_sec_data = {}
        data['sections'].append(child_sec_data)
        set_sec_dendrogram(template_name, child_sec, child_sec_data)

    if len(data['sections']) == 0:
        total_width = data['width']
    else:
        total_width = 0

    for s in data['sections']:
        total_width += s['total_width']
    data['total_width'] = total_width


def get_syns(nrn, path, template_name, all_sec_map):
    '''Get synapses.'''
    synapses = {}
    synapses_meta = json.loads(path.read_bytes())
    for synapse_type in synapses_meta.keys():
        for synapse in synapses_meta[synapse_type]:
            if hasattr(nrn.h, synapse):
                for syn in getattr(nrn.h, synapse):
                    id_ = re.search(r'\[(\d+)\]', str(syn)).group(1)
                    seg = syn.get_segment()
                    sec = seg.sec
                    sec_name = get_sec_name(template_name, sec)
                    # 0.9999999 just so that seg_idx is not equal to 1
                    seg_idx = int(np.fix(all_sec_map[sec_name]['nseg']
                                         * seg.x * 0.9999999))
                    if synapses.get(synapse_type):
                        synapses[synapse_type].append({
                            'sec_name': sec_name,
                            'seg_idx': seg_idx,
                            'id': id_})
                    else:
                        synapses[synapse_type] = [{
                            'sec_name': sec_name,
                            'seg_idx': seg_idx,
                            'id': id_}]
    return synapses
