"""Compatibility import for :mod:`app.infrastructure.tracing`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.infrastructure.tracing")
