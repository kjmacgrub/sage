"""
Shared outbound HTTP client, pinned to IPv4.

httpx tries a host's IPv6 address first and spends its whole connect timeout
there before falling back. When the Mac's IPv6 route is black-holed (seen
2026-10-18 on Fios: v6 SYNs to Yahoo never answered, v4 fine) every fetch took
~70 s and a 32-fund price refresh ~40 min, which read as "Refresh does nothing".
Binding the local address to 0.0.0.0 restricts httpx to IPv4; every host this
app calls (CEFConnect, Yahoo, SEC) serves v4.
"""
import httpx


def transport() -> httpx.HTTPTransport:
    return httpx.HTTPTransport(local_address="0.0.0.0")


client = httpx.Client(transport=transport())


def get(url: str, **kwargs) -> httpx.Response:
    """Drop-in for httpx.get(); same keyword arguments."""
    return client.get(url, **kwargs)
