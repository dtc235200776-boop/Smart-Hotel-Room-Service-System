function isLocalQrHost(hostname) {
  return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(hostname);
}

async function getHotelQrAddress(pathname) {
  const url = new URL(pathname, location.origin);

  // A site already opened through its LAN IP or public domain can keep that origin.
  if (!isLocalQrHost(url.hostname)) return { url, addresses: [] };

  try {
    const response = await fetch('/api/network', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { url, addresses: [] };
    const network = await response.json();
    return { url: new URL(pathname, network.url), addresses: network.addresses || [] };
  } catch (_) {
    return { url, addresses: [] };
  }
}

function createHotelQrImage(link) {
  const code = qrcode(0, 'M');
  code.addData(String(link));
  code.make();

  const scale = 8;
  const margin = scale * 4;
  const modules = code.getModuleCount();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = modules * scale + margin * 2;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (code.isDark(row, col)) context.fillRect(margin + col * scale, margin + row * scale, scale, scale);
    }
  }
  return canvas.toDataURL('image/png');
}
