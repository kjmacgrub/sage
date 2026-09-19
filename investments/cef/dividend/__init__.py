"""Dividend-growth sleeve — sleeve four.

Deliberately separate from the CEF/BDC book rather than sharing its tables.
The two sleeves want different schemas: a CEF has NAV, premium to NAV and a
distribution audit; a common stock has payout ratio, free-cash-flow coverage
and an immutable original outlay that the CEF sleeve has no use for. Forcing
both into one set of tables means every row carries the other's columns as
nulls, and a second broker (this sleeve may end up at Fidelity) would push its
quirks into tables the live CEF book depends on.

Decision recorded in ../../docs/decisions.md, 2026-09-19.
"""
