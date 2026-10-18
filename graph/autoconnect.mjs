export function portIdentity(port) {
  const info = port.getInfo?.() ?? {};
  return JSON.stringify([info.usbVendorId ?? null, info.usbProductId ?? null]);
}

export function chooseAutomaticPort(ports, preferredIdentity) {
  const matches = preferredIdentity
    ? ports.filter(port => portIdentity(port) === preferredIdentity)
    : ports;
  // Identical USB adapters cannot be distinguished by getInfo. Ask the user.
  return matches.length === 1 ? matches[0] : null;
}
