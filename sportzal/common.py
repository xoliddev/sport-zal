"""The refusal error every rule raises; ``code`` maps to an ``err.<code>`` text in shared/locales."""

from __future__ import annotations


class Refused(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code
