"""Compatibility import for :mod:`app.application.runtime`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.application.runtime")
