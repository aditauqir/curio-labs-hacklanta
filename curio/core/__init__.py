"""Core: images, colour, blend modes, layers, seeding.

Kept free of imports from ``curio.ops`` at module load so the registry and the
op modules can depend on core without a cycle.
"""
