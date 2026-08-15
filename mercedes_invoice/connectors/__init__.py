from .base import (
    LoginRequiredError,
    PartNotFoundError,
    PriceResult,
    PriceSource,
    PriceSourceError,
)
from .mercedes import MercedesPriceSource
from .mock import MockPriceSource

__all__ = [
    "PriceResult",
    "PriceSource",
    "PriceSourceError",
    "PartNotFoundError",
    "LoginRequiredError",
    "MockPriceSource",
    "MercedesPriceSource",
]


def make_source(name: str) -> PriceSource:
    """Factory used by the app to create the configured price source."""
    name = (name or "mock").lower()
    if name == "mercedes":
        return MercedesPriceSource()
    return MockPriceSource()
