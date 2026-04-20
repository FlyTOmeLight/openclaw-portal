// Separate module so api/client.ts can import clearAuthCache without pulling
// the router (and thus every lazy-loaded view) into the API layer's module graph.

let _authed: boolean | null = null

export function getAuthCache(): boolean | null {
  return _authed
}

export function setAuthCache(value: boolean) {
  _authed = value
}

export function clearAuthCache() {
  _authed = null
}
