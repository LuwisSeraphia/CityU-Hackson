"""Compatibility import for :mod:`app.infrastructure.db`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.infrastructure.db")
