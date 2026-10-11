"""Curio Labs raster design engine.

Hard rule: no pixel in any output comes from a generative model. Every image is
produced by deterministic operations (same inputs + same params + same seed =
same output) applied to sourced or user-supplied assets, real fonts and vector
drawing. Language or vision models may reason about a design elsewhere in the
system; nothing in this package accepts or returns model-made pixels.
"""

__version__ = "0.1.0"
