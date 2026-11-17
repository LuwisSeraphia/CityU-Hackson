"""Compatibility import for :mod:`app.api.knowledge_routes`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.api.knowledge_routes")
