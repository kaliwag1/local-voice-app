export function isBonsai(key) {
  return key === 'bonsai/official' || key === 'bonsai/crack'
}

export function localModelRoute(key) {
  return isBonsai(key)
    ? { model: 'bonsai', baseUrl: 'http://127.0.0.1:8080/v1' }
    : { model: key, baseUrl: 'http://127.0.0.1:1234/v1' }
}
