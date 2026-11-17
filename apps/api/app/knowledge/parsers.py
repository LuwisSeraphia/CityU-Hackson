"""Compatibility import for :mod:`app.domain.knowledge.parsers`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.domain.knowledge.parsers")
