// Module worker. Runs homr (Python, via Pyodide) with its ONNX models on onnxruntime-web.
// Python blocks on model calls through JSPI, so this needs a JSPI-capable
// browser (Chrome/Edge 137+).

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const MODEL_CACHE = "partscanner-models-v1";
const MODELS = [
  "segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f.onnx",
  "encoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx",
  "decoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx",
];
// Uncompressed total, for progress: servers may gzip, so content-length
// doesn't match the bytes received.
const MODELS_TOTAL_BYTES = 157482318;
// The decoder runs hundreds of tiny steps per staff, where WebGPU's per-call
// overhead loses to WASM; the big convolutional models gain from the GPU.
const GPU_MODELS = new Set([MODELS[0], MODELS[1]]);

let ort;

const post = (msg) => self.postMessage(msg);
const modelBytes = new Map();
const sessions = [];
const sessionIds = new Map();
let useGpu = false;

async function fetchModel(name) {
  const url = new URL("models/" + name, location.href).href;
  const cache = await caches.open(MODEL_CACHE);
  const cached = await cache.match(url);
  if (cached) return new Uint8Array(await cached.arrayBuffer());

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed: ${name} (${res.status})`);
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ type: "progress", stage: "download", name, loaded, total: MODELS_TOTAL_BYTES });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  await cache.put(url, new Response(bytes));
  return bytes;
}

const TYPED = {
  float32: Float32Array,
  int64: BigInt64Array,
  int32: Int32Array,
  uint8: Uint8Array,
  bool: Uint8Array,
};

// Called from omr/onnxruntime.py.
self.omrOrt = {
  async create(name) {
    if (!sessionIds.has(name)) {
      const eps = useGpu && GPU_MODELS.has(name) ? ["webgpu", "wasm"] : ["wasm"];
      const t0 = performance.now();
      const session = await ort.InferenceSession.create(modelBytes.get(name), {
        executionProviders: eps,
        graphOptimizationLevel: "all",
      });
      post({ type: "log", msg: `Loaded ${name} on ${eps[0]} in ${Math.round(performance.now() - t0)} ms` });
      sessionIds.set(name, sessions.push(session) - 1);
      modelBytes.delete(name);
    }
    const s = sessions[sessionIds.get(name)];
    return { id: sessionIds.get(name), inputNames: s.inputNames, outputNames: s.outputNames };
  },

  async run(id, names, feeds) {
    const inputs = {};
    for (const [name, type, dims, bytes] of feeds) {
      inputs[name] = new ort.Tensor(type, new TYPED[type](bytes.slice().buffer), dims);
    }
    const out = await sessions[id].run(inputs, names);
    return names.map((n) => {
      const t = out[n];
      const d = t.data;
      return { type: t.type, dims: t.dims, data: new Uint8Array(d.buffer, d.byteOffset, d.byteLength) };
    });
  },
};

let pyodide;
let recognise;

async function init() {
  if (typeof WebAssembly.Suspending !== "function") {
    throw new Error("This browser lacks WebAssembly JSPI. Use an up-to-date Chrome.");
  }
  ort = await import(ORT_URL + "ort.webgpu.min.mjs");
  ort.env.wasm.wasmPaths = ORT_URL;
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1;
  const { loadPyodide } = await import(PYODIDE_URL + "pyodide.mjs");
  useGpu = !!(self.navigator.gpu && (await navigator.gpu.requestAdapter()));

  post({ type: "progress", stage: "python" });
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  pyodide.setStderr({ batched: (msg) => post({ type: "log", msg }) });
  pyodide.setStdout({ batched: (msg) => post({ type: "log", msg }) });
  await pyodide.loadPackage(["numpy", "opencv-python", "pillow", "typing-extensions"]);

  const lib = "/home/pyodide/lib";
  pyodide.FS.mkdirTree(lib);
  const homrZip = await (await fetch("vendor/homr.zip")).arrayBuffer();
  pyodide.unpackArchive(homrZip, "zip", { extractDir: lib });
  for (const f of ["onnxruntime.py", "runner.py"]) {
    pyodide.FS.writeFile(`${lib}/${f}`, await (await fetch("omr/" + f)).text());
  }
  pyodide.runPython(`import sys; sys.path.insert(0, "${lib}")`);
  recognise = pyodide.pyimport("runner").recognise;

  for (const name of MODELS) {
    if (!modelBytes.has(name)) modelBytes.set(name, await fetchModel(name));
  }
  post({ type: "ready", gpu: useGpu });
}

let ready;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      ready ??= init();
      await ready;
    } else if (data.type === "recognise") {
      await ready;
      const path = `/tmp/page${data.id}.png`;
      pyodide.FS.writeFile(path, new Uint8Array(data.image));
      const t0 = performance.now();
      const xml = await recognise.callPromising(path);
      post({ type: "result", id: data.id, xml, ms: Math.round(performance.now() - t0) });
    }
  } catch (e) {
    post({ type: "error", id: data.id, msg: String(e && e.message ? e.message : e) });
  }
};
