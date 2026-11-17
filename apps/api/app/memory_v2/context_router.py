"""Compatibility import for :mod:`app.api.context_routes`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.api.context_routes")
