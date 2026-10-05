"""Minimal stand-in for the `onnxruntime` package inside Pyodide.

homr only uses InferenceSession + IOBinding + OrtValue. Each call is forwarded
to onnxruntime-web through `self.omrOrt` (defined in omr-worker.js) and blocks
on the JS promise via JSPI (`run_sync`).
"""

import os

import js
import numpy as np
from pyodide.ffi import run_sync, to_js

_DTYPES = {
    "float32": np.float32,
    "float16": np.float16,
    "int64": np.int64,
    "int32": np.int32,
    "uint8": np.uint8,
    "bool": np.bool_,
}


def get_available_providers():
    return ["CPUExecutionProvider"]


def set_default_logger_severity(level):
    pass


def preload_dlls():
    pass


class _NodeArg:
    def __init__(self, name):
        self.name = name


class OrtValue:
    """A tensor: a numpy array, or (handle set) one kept on the JS side."""

    def __init__(self, array, handle=None):
        self._array = array
        self._handle = handle

    def numpy(self):
        if self._array is None:
            self._array = np.frombuffer(js.omrOrt.data(self._handle).to_bytes(), dtype=self._dtype).reshape(self._dims)
        return self._array

    @staticmethod
    def _kept(handle, dtype, dims):
        value = OrtValue(None, handle)
        value._dtype, value._dims = dtype, dims
        return value

    @staticmethod
    def ortvalue_from_numpy(array, *args, **kwargs):
        return OrtValue(np.ascontiguousarray(array))


class IOBinding:
    def __init__(self, session):
        self._session = session
        self._inputs = {}
        self._output_names = []
        self._outputs = []

    def bind_cpu_input(self, name, array):
        self._inputs[name] = np.ascontiguousarray(array)

    def bind_ortvalue_input(self, name, value):
        self._inputs[name] = value if value._handle is not None else value._array

    def bind_output(self, name, *args, **kwargs):
        if name not in self._output_names:
            self._output_names.append(name)

    def get_outputs(self):
        return self._outputs


def _to_js_bytes(array):
    data = js.Uint8Array.new(array.nbytes)
    data.assign(array.reshape(-1).view(np.uint8))
    return data


class InferenceSession:
    def __init__(self, path, *args, **kwargs):
        info = run_sync(js.omrOrt.create(os.path.basename(path)))
        self._id = info.id
        self._inputs = [_NodeArg(n) for n in info.inputNames.to_py()]
        self._outputs = [_NodeArg(n) for n in info.outputNames.to_py()]

    def get_inputs(self):
        return self._inputs

    def get_outputs(self):
        return self._outputs

    def io_binding(self):
        return IOBinding(self)

    def run(self, output_names, feeds, *args, **kwargs):
        names = output_names or [o.name for o in self._outputs]
        return [v.numpy() for v in self._run(names, feeds)]

    def run_with_iobinding(self, iobinding=None, *args, **kwargs):
        # homr's decoder cache ("cache_out*") only goes back in on the next
        # step, so it stays on the JS side (see omr-worker.js).
        keep = [n for n in iobinding._output_names if n.startswith("cache_out")]
        iobinding._outputs = self._run(iobinding._output_names, iobinding._inputs, keep)

    def _run(self, names, feeds, keep=()):
        js_feeds = [
            to_js([name, "kept", a._handle, None])
            if isinstance(a, OrtValue)
            else to_js([name, str(a.dtype), list(a.shape), _to_js_bytes(a)])
            for name, a in feeds.items()
        ]
        results = run_sync(js.omrOrt.run(self._id, to_js(names), to_js(js_feeds), to_js(list(keep))))
        outputs = []
        for r in results:
            dtype = _DTYPES[r.type]
            dims = r.dims.to_py()
            if r.handle:  # 0: not kept (handles start at 1)
                outputs.append(OrtValue._kept(r.handle, dtype, dims))
            else:
                outputs.append(OrtValue(np.frombuffer(r.data.to_bytes(), dtype=dtype).reshape(dims)))
        return outputs
