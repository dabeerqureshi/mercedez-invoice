"""PriceSource interface.

The whole application talks to this interface only, so the rest of the
system never cares where the price came from (offline mock, the real
Mercedes site, or a future different vendor).
"""
import datetime
from dataclasses import dataclass


@dataclass
class PriceResult:
    """A single live price lookup for one part number."""
    part_number: str
    price: float
    currency: str
    retrieved_at: str  # ISO timestamp persisted with the invoice item
    designation: str = ""  # product name / description


def now_iso() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


class PriceSourceError(Exception):
    """Base for price-lookup errors surfaced to the UI."""


class PartNotFoundError(PriceSourceError):
    """The requested part number returned no usable result."""


class LoginRequiredError(PriceSourceError):
    """The Mercedes session is not authenticated / has expired."""


class PriceSource:
    """Subclasses must implement get_price() and may override close()."""

    name = "base"  # identifier used in settings / logs

    def get_price(self, part_number: str) -> PriceResult:
        raise NotImplementedError

    def close(self) -> None:
        pass

    @property
    def status(self) -> str:
        """Human-readable status shown in the UI status bar."""
        return "ready"
