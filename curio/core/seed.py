"""Deterministic seeding.

Python's built-in ``hash()`` is randomised per process, so it must never feed a
seed. Seeds are derived from a stable digest instead, which means a recipe
renders to the same pixels on any machine and in any process.
"""

from __future__ import annotations

import hashlib

import numpy as np


def derive_seed(seed: int, *keys: object) -> int:
    """Derives a stable 31-bit child seed from a parent seed and any keys.

    Keys are typically an op name and a position, so two steps in one stack get
    different noise from a single top-level seed.
    """
    digest = hashlib.blake2b(digest_size=8)
    digest.update(repr((int(seed),) + tuple(keys)).encode("utf-8"))
    return int.from_bytes(digest.digest(), "big") & 0x7FFFFFFF


def rng(seed: int, *keys: object) -> np.random.Generator:
    """A NumPy generator that depends only on ``seed`` and ``keys``."""
    return np.random.default_rng(derive_seed(seed, *keys))
