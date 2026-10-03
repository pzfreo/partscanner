"""Runs homr on one page image inside Pyodide and returns its MusicXML."""

import sys
import types


def _stub(name, **attrs):
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    sys.modules[name] = module


# Optional homr features (title OCR, PDF input, model download) whose
# dependencies are not available in Pyodide. Title detection is disabled below.
_stub("rapidocr", RapidOCR=None)
_stub("pypdfium2")
_stub("requests", exceptions=types.SimpleNamespace(RequestException=Exception))

from homr.debug import Debug  # noqa: E402
from homr.main import ProcessingConfig, process_image  # noqa: E402
from homr.music_xml_generator import XmlGeneratorArguments  # noqa: E402

# Skip writing the preview PNG; the app shows the original photo instead.
Debug.write_teaser = lambda *args, **kwargs: None

_CONFIG = ProcessingConfig(
    enable_debug=False,
    enable_cache=False,
    write_staff_positions=False,
    read_staff_positions=False,
    selected_staff=-1,
    transformer_use_gpu=False,
    segnet_use_gpu=False,
    coreml_encoder=False,
    title_detection=False,
)


def recognise(image_path):
    xml_path = process_image(image_path, _CONFIG, XmlGeneratorArguments())
    with open(xml_path, encoding="utf-8") as f:
        return f.read()
