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
const sessions = [];
const sessionNames = []; // id -> model name
const onGpu = new Set(); // ids of sessions created on WebGPU
const sessionIds = new Map();
let useGpu = false;

// Models download in 4 MB pieces (HTTP range requests), each stored as it
// arrives, so a dropped or crawling connection resumes where it stopped (even
// after the app is closed) instead of restarting a 57 MB file.
const PIECE = 4 * 1024 * 1024;
const STALL_MS = 30000;
const MODEL_SIZES = {
  [MODELS[0]]: 57311361,
  [MODELS[1]]: 52861122,
  [MODELS[2]]: 47309835,
};
const modelUrl = (name) => new URL("models/" + name, location.href).href;
const pieceKey = (name, i) => `${modelUrl(name)}?piece=${i}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPiece(url, start, end) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), STALL_MS);
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: "no-store", signal: abort.signal });
    if (res.status === 200) return { whole: await res.arrayBuffer() }; // server ignores ranges
    if (res.status !== 206) throw new Error(`unexpected response ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== end - start + 1) throw new Error("short read");
    return { piece: buf };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadModel(name) {
  const cache = await caches.open(MODEL_CACHE);
  if (await cache.match(modelUrl(name))) return; // stored whole by an earlier version
  const size = MODEL_SIZES[name];
  let loaded = 0;
  for (let i = 0; i * PIECE < size; i++) {
    const start = i * PIECE;
    const end = Math.min(size, start + PIECE) - 1;
    if (!(await cache.match(pieceKey(name, i)))) {
      for (let attempt = 1; ; attempt++) {
        try {
          const got = await fetchPiece(modelUrl(name), start, end);
          if (got.whole) {
            if (got.whole.byteLength !== size) throw new Error("short read");
            await cache.put(modelUrl(name), new Response(got.whole));
            post({ type: "progress", stage: "download", name, loaded: size, total: MODELS_TOTAL_BYTES });
            return;
          }
          await cache.put(pieceKey(name, i), new Response(got.piece));
          break;
        } catch (e) {
          if (attempt >= 8) {
            throw new Error(
              `the connection keeps dropping (${e.message}). What has downloaded is kept; try again on a better connection`,
            );
          }
          post({ type: "progress", stage: "retry", name, attempt });
          await sleep(Math.min(30000, 2000 * attempt * attempt));
        }
      }
    }
    loaded = end + 1;
    post({ type: "progress", stage: "download", name, loaded, total: MODELS_TOTAL_BYTES });
  }
}

async function modelBytes(name) {
  const cache = await caches.open(MODEL_CACHE);
  const whole = await cache.match(modelUrl(name));
  if (whole) return new Uint8Array(await whole.arrayBuffer());
  const size = MODEL_SIZES[name];
  const bytes = new Uint8Array(size);
  for (let i = 0; i * PIECE < size; i++) {
    const piece = await cache.match(pieceKey(name, i));
    if (!piece) throw new Error(`model piece missing: ${name} #${i}`);
    bytes.set(new Uint8Array(await piece.arrayBuffer()), i * PIECE);
  }
  return bytes;
}

const TYPED = {
  float32: Float32Array,
  int64: BigInt64Array,
  int32: Int32Array,
  uint8: Uint8Array,
  bool: Uint8Array,
};

const kept = new Map(); // handle -> ort.Tensor
let lastKept = 0;

async function newSession(id) {
  const name = sessionNames[id];
  const gpu = useGpu && GPU_MODELS.has(name);
  const eps = gpu ? ["webgpu", "wasm"] : ["wasm"];
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(await modelBytes(name), {
    executionProviders: eps,
    graphOptimizationLevel: "all",
  });
  if (gpu) onGpu.add(id);
  else onGpu.delete(id);
  post({ type: "log", msg: `Loaded ${name} on ${eps[0]} in ${Math.round(performance.now() - t0)} ms` });
  return session;
}

// Called from omr/onnxruntime.py.
self.omrOrt = {
  async create(name) {
    if (!sessionIds.has(name)) {
      const id = sessions.length;
      sessionNames[id] = name;
      sessions[id] = await newSession(id);
      sessionIds.set(name, id);
    }
    const s = sessions[sessionIds.get(name)];
    return { id: sessionIds.get(name), inputNames: s.inputNames, outputNames: s.outputNames };
  },

  // feeds: [name, type, dims, bytes], or [name, "kept", handle] for an output
  // kept from an earlier run. Outputs named in `keep` stay here as handles
  // (homr's decoder cache: Python only passes it back in on the next step, so
  // copying it across every step was most of the decoder's time). A kept
  // tensor is released once it has been passed back in.
  async run(id, names, feeds, keep = []) {
    const t0 = performance.now();
    const inputs = {};
    const used = [];
    for (const [name, type, dims, bytes] of feeds) {
      if (type === "kept") {
        inputs[name] = kept.get(dims);
        used.push(dims);
      } else inputs[name] = new ort.Tensor(type, new TYPED[type](bytes.slice().buffer), dims);
    }
    let out;
    try {
      out = await sessions[id].run(inputs, names);
    } catch (e) {
      // The phone's GPU can go away (e.g. under memory pressure); onnxruntime's
      // WebGPU backend then fails every run. Carry on without the GPU.
      if (!onGpu.has(id)) throw e;
      post({ type: "log", msg: `WebGPU run failed (${e.message}); using WASM from now on` });
      useGpu = false;
      for (const other of [...onGpu]) {
        const old = sessions[other];
        Promise.resolve().then(() => old.release()).catch(() => {});
        sessions[other] = await newSession(other);
      }
      out = await sessions[id].run(inputs, names);
    }
    for (const h of used) kept.delete(h);
    const t = (runTimes[id] ??= { calls: 0, ms: 0 });
    t.calls++;
    t.ms += performance.now() - t0;
    return names.map((n) => {
      const t = out[n];
      if (keep.includes(n)) {
        kept.set(++lastKept, t);
        return { type: t.type, dims: t.dims, handle: lastKept };
      }
      const d = t.data;
      return { type: t.type, dims: t.dims, data: new Uint8Array(d.buffer, d.byteOffset, d.byteLength), handle: 0 };
    });
  },

  // The contents of a kept output, if Python does want to read one.
  data(handle) {
    const d = kept.get(handle).data;
    return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  },
};

let pyodide;
let recognise;
// Per page: time inside each model (session id -> { calls, ms }); the rest of
// the page's time is homr's Python (image processing, decoding) in Pyodide.
let runTimes = [];

async function init() {
  if (typeof WebAssembly.Suspending !== "function") {
    throw new Error("This browser lacks WebAssembly JSPI. Use an up-to-date Chrome.");
  }
  ort = await import(ORT_URL + "ort.webgpu.min.mjs");
  ort.env.wasm.wasmPaths = ORT_URL;
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1;
  post({ type: "log", msg: `WASM threads: ${ort.env.wasm.numThreads}` });
  const { loadPyodide } = await import(PYODIDE_URL + "pyodide.mjs");
  useGpu = !!(self.navigator.gpu && (await navigator.gpu.requestAdapter()));

  post({ type: "progress", stage: "python" });
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  pyodide.setStderr({ batched: (msg) => post({ type: "log", msg }) });
  pyodide.setStdout({ batched: (msg) => post({ type: "log", msg }) });
  await pyodide.loadPackage(["numpy", "opencv-python", "pillow", "typing-extensions"]);

  const lib = "/home/pyodide/lib";
  pyodide.FS.mkdirTree(lib);
  // Same deploy version as this worker (?v=… from scripts/stamp-version.mjs).
  const v = location.search;
  const homrZip = await (await fetch("vendor/homr.zip" + v)).arrayBuffer();
  pyodide.unpackArchive(homrZip, "zip", { extractDir: lib });
  for (const f of ["onnxruntime.py", "runner.py"]) {
    pyodide.FS.writeFile(`${lib}/${f}`, await (await fetch("omr/" + f + v)).text());
  }
  pyodide.runPython(`import sys; sys.path.insert(0, "${lib}")`);
  recognise = pyodide.pyimport("runner").recognise;

  for (const name of MODELS) {
    await downloadModel(name);
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
      runTimes = [];
      // data.systems: the user's systems for this page (JSON), if they fixed it.
      const xml = await recognise.callPromising(path, data.systems ?? "");
      const ms = Math.round(performance.now() - t0);
      const names = [...sessionIds.keys()];
      const parts = names.map((n) => `${n.split("_")[0]} ${Math.round(runTimes[sessionIds.get(n)]?.ms ?? 0)} ms/${runTimes[sessionIds.get(n)]?.calls ?? 0} calls`);
      const inModels = runTimes.reduce((sum, t) => sum + (t?.ms ?? 0), 0);
      post({ type: "log", msg: `Page in ${ms} ms: ${parts.join(", ")}; Python ${Math.round(ms - inModels)} ms` });
      post({ type: "result", id: data.id, xml, ms });
    }
  } catch (e) {
    post({ type: "error", id: data.id, msg: String(e && e.message ? e.message : e) });
  }
};
