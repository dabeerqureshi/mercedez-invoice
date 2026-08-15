"""Offline deterministic price source.

Lets the whole scan -> price -> cart -> VAT/discount -> PDF -> email
pipeline be developed and tested with no network and no Mercedes login.
The pseudo-price is derived deterministically from the part number so it is
repeatable for testing.
"""
import hashlib

from .. import config
from .base import PriceResult, PriceSource, now_iso


class MockPriceSource(PriceSource):
    name = "mock"
    _NAMES = [
        "BATTERY PACK", "BRAKE DISC", "OIL FILTER", "SPARK PLUG",
        "WIPER BLADE", "AIR FILTER", "CLUTCH KIT", "BRAKE PAD SET",
    ]

    def get_price(self, part_number: str) -> PriceResult:
        h = hashlib.md5(part_number.encode("utf-8")).hexdigest()
        # 0.00 .. 499.99 pseudo-price, deterministic per part number
        price = round(int(h[:6], 16) % 50000 / 100.0, 2)
        name = self._NAMES[int(h[:2], 16) % len(self._NAMES)]
        return PriceResult(
            part_number=part_number,
            price=price,
            currency=config.CURRENCY_CODE,
            retrieved_at=now_iso(),
            designation=name,
        )

    @property
    def status(self) -> str:
        return "mock (offline, test prices)"
