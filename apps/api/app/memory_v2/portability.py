"""Compatibility import for :mod:`app.domain.memory.portability`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.domain.memory.portability")
