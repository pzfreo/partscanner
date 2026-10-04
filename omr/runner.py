"""Runs homr on one page image inside Pyodide and returns its MusicXML."""

import sys
import types


def _stub(name, **attrs):
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    sys.modules[name] = module


# Optional homr features (title OCR, PDF input, model download) whose
# dependencies are not available in Pyodide. Title detection is disabled below.
_stub("rapidocr", RapidOCR=type("RapidOCR", (), {}))
_stub("pypdfium2")
_stub("requests", exceptions=types.SimpleNamespace(RequestException=Exception))

import xml.etree.ElementTree as ET  # noqa: E402

from homr import music_xml_generator  # noqa: E402
from homr.debug import Debug  # noqa: E402
from homr.main import ProcessingConfig, process_image  # noqa: E402
from homr.music_xml_generator import XmlGeneratorArguments  # noqa: E402

# homr's model tags every note with its voice on the staff (upper/upper2 on the
# top staff, lower/lower2 on the bottom: stem-up vs stem-down voices), but the
# MusicXML writer renumbers voices by rhythm and loses that. Keep it as a
# comment, next to the image-position comment, for the app's part split.
_build_image_position = music_xml_generator.build_image_position


def _build_image_position_and_voice(xml, symbol):
    _build_image_position(xml, symbol)
    xml.append(ET.Comment(f" homr-voice: {symbol.position} "))


music_xml_generator.build_image_position = _build_image_position_and_voice

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
