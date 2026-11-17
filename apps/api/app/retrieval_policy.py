"""Compatibility import for :mod:`app.domain.retrieval.policy`."""

import sys
from importlib import import_module

sys.modules[__name__] = import_module("app.domain.retrieval.policy")
