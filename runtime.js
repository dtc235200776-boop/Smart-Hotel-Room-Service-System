(() => {
  const BUILD_VERSION = '2026-11-19-golden-haven-1';
  const isServer = value => value?.ok === true && value.version === BUILD_VERSION && value.service === 'hotel-room-service';
  
  const showStartHint = () => {
    const add = () => {
      if (document.getElementById('hotelServerHint')) return;
      const hint = document.createElement('aside');
      hint.id = 'hotelServerHint';
      hint.setAttribute('role', 'alert');
      hint.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:12px;">
          <span style="font-size:24px; line-height:1;">⚠️</span>
          <div>
            <strong style="font-size:15px; display:block; margin-bottom:4px; color:#92400e;">Máy chủ Node.js chưa được khởi chạy!</strong>
            <p style="margin:0 0 6px 0; font-size:13px; color:#78350f;">
              Bạn đang mở file qua <b>VS Code Live Server (cổng 5500)</b>. Live Server chỉ phục vụ giao diện tĩnh và không có Backend API.
            </p>
            <p style="margin:0; font-size:13px; color:#78350f;">
              👉 <b>Cách chạy:</b> Nhấp đúp vào file <code style="background:#fed7aa; padding:2px 6px; border-radius:4px; font-weight:bold;">start-pos.bat</code> trong thư mục dự án (hoặc mở Terminal gõ <code style="background:#fed7aa; padding:2px 6px; border-radius:4px; font-weight:bold;">node server.js</code>), sau đó hệ thống sẽ tự mở cổng 3000 đầy đủ tính năng!
            </p>
          </div>
        </div>
      `;
      Object.assign(hint.style, {
        position: 'fixed',
        zIndex: '2147483647',
        inset: '16px 16px auto',
        padding: '16px 20px',
        borderRadius: '12px',
        background: '#fffbeb',
        color: '#78350f',
        border: '2px solid #f59e0b',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        font: 'normal 14px/1.5 system-ui, sans-serif'
      });
      (document.body || document.documentElement).prepend(hint);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true }); else add();
  };

  async function probe(port) {
    const protocol = location.protocol === 'file:' ? 'http:' : location.protocol;
    const host = location.hostname || 'localhost';
    const origin = `${protocol}//${host}${port ? `:${port}` : ''}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return null;
      const data = await response.json();
      return isServer(data) ? { origin, port: Number(data.port || port || 80) } : null;
    } catch (_) { return null; }
  }

  (async () => {
    // Nếu đang ở cổng Live Server (5500)
    if (location.protocol !== 'file:' && location.port === '5500') {
      // Kiểm tra xem máy chủ Node.js đã bật chưa (thử cổng 3000-3010)
      const ports = [3000, 3001, 3002];
      const found = await Promise.race([
        ...ports.map(p => probe(String(p)).then(res => res ? res : new Promise(() => {}))),
        new Promise(resolve => setTimeout(() => resolve(null), 900))
      ]);

      if (found && found.origin) {
        const pathParts = location.pathname.split('/').filter(Boolean);
        let pageName = pathParts.pop() || 'home.html';
        if (pageName === 'index.html' && pathParts.at(-1) === 'qrcodes') pageName = 'letan.html';
        if (pageName === 'qrcodes') pageName = 'letan.html';
        if (!pageName.endsWith('.html')) pageName = 'home.html';
        location.replace(`${found.origin}/${pageName}${location.search}${location.hash}`);
        return;
      }

      // Nếu máy chủ Node.js CHƯA BẬT: KHÔNG redirect làm sập trang, mà hiển thị thông báo hướng dẫn
      showStartHint();
      return;
    }

    const current = location.protocol !== 'file:' ? await probe(location.port || '') : null;
    if (current) return;

    const candidates = await Promise.all(Array.from({ length: 11 }, (_, index) => 3010 - index)
      .filter(port => String(port) !== location.port)
      .map(port => probe(String(port))));
    const server = candidates.find(Boolean);
    if (server) {
      const pathParts = location.pathname.split('/').filter(Boolean);
      let pageName = pathParts.pop() || 'home.html';
      if (pageName === 'index.html' && pathParts.at(-1) === 'qrcodes') pageName = 'letan.html';
      if (pageName === 'qrcodes') pageName = 'letan.html';
      if (!pageName.endsWith('.html')) pageName = 'home.html';
      location.replace(`${server.origin}/${pageName}${location.search}${location.hash}`);
      return;
    }

    showStartHint();
  })();
})();
