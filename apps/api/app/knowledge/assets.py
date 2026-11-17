"""Compatibility import for :mod:`app.domain.knowledge.assets`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.domain.knowledge.assets")
