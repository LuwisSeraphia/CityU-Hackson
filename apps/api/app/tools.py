"""Compatibility import for :mod:`app.application.tools`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.application.tools")
