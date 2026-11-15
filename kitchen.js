const money = value => Number(value || 0) === 0 ? 'Miễn phí' : `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const API_BASE = (location.port === '5500') ? `${location.protocol}//${location.hostname}:3000` : '';
const apiUrl = path => `${API_BASE}${path}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let orders = [];
let previousOrderIds = new Set();
let currentFilter = 'active'; // 'active' (pending + cooking), 'all', 'ready'
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Mở khóa âm thanh khi người dùng tương tác lần đầu
window.addEventListener('click', () => getAudioContext(), { once: true });
window.addEventListener('keydown', () => getAudioContext(), { once: true });

function updateKitchenClock() {
  const clock = document.getElementById('kdsClock');
  if (clock) clock.textContent = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}
updateKitchenClock();
setInterval(updateKitchenClock, 1000);

async function api(url, options = {}) {
  const response = await fetch(apiUrl(url), { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const result = response.status === 204 ? {} : await response.json();
  if (response.status === 401) { location.replace(`/staff-login.html?next=${encodeURIComponent('/kitchen.html')}`); throw new Error('Cần đăng nhập nhân viên khách sạn.'); }
  if (!response.ok) throw new Error(result.error || 'Không thể kết nối máy chủ.');
  return result;
}

function playAlert() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(880, ctx.currentTime);
    tone.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    tone.connect(gain);
    gain.connect(ctx.destination);
    tone.start(ctx.currentTime);
    tone.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

function renderStation(station, rootId, countId) {
  let stationOrders = orders.filter(order => order.status !== 'paid' && order.status !== 'cancelled' && order.stations?.[station]);
  
  if (currentFilter === 'active') {
    stationOrders = stationOrders.filter(order => order.stations[station] === 'pending' || order.stations[station] === 'cooking');
  } else if (currentFilter === 'ready') {
    stationOrders = stationOrders.filter(order => order.stations[station] === 'ready');
  }

  document.getElementById(countId).textContent = `${stationOrders.length} yêu cầu`;
  document.getElementById(rootId).innerHTML = stationOrders.length ? stationOrders.map(order => {
    const status = order.stations[station];
    const items = order.items.filter(item => item.section === station);
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(order.createdAt)) / 60000));
    const action = status === 'pending'
      ? `<button data-order="${escapeHtml(order.id)}" data-station="${station}" data-status="cooking">Tiếp nhận phục vụ</button>`
      : status === 'cooking'
      ? `<button class="ready-action" data-order="${escapeHtml(order.id)}" data-station="${station}" data-status="ready">Hoàn tất phục vụ</button>`
      : '<span class="ready-label">✓ Đã phục vụ</span>';
      
    const statusText = { pending: 'CHỜ TIẾP NHẬN', cooking: 'ĐANG PHỤC VỤ TẠI PHÒNG', ready: 'ĐÃ HOÀN TẤT' }[status] || 'ĐANG XỬ LÝ';
    
    return `
      <article class="ticket-card ${status}">
        <header class="ticket-head">
          <div>
            <span class="ticket-table">${escapeHtml(order.table)}</span>
            <span class="ticket-code">#${escapeHtml(order.id)}</span>
          </div>
          <span class="ticket-age ${minutes >= 15 ? 'late' : ''}">${minutes === 0 ? 'Vừa gửi' : `${minutes} phút trước`}</span>
        </header>
        <div class="ticket-status"><i></i>${statusText}</div>
        <ul>
          ${items.map(item => `<li><div><b>${escapeHtml(item.name)}</b>${item.note ? `<small>Ghi chú: ${escapeHtml(item.note)}</small>` : ''}</div><strong>×${item.qty}</strong></li>`).join('')}
        </ul>
        <footer>${action}</footer>
      </article>`;
  }).join('') : '<div class="station-empty"><span>✓</span><b>Không có yêu cầu nào</b><small>Yêu cầu dịch vụ từ khách sẽ tự động xuất hiện tại đây</small></div>';
}

function renderKitchen() {
  const activeOrders = orders.filter(order => order.status !== 'paid' && order.status !== 'cancelled');
  const pending = activeOrders.reduce((sum, order) => sum + Object.values(order.stations || {}).filter(status => status === 'pending').length, 0);
  const cooking = activeOrders.reduce((sum, order) => sum + Object.values(order.stations || {}).filter(status => status === 'cooking').length, 0);
  const ready = activeOrders.filter(order => order.status === 'ready' || order.status === 'served').length;
  
  document.getElementById('pendingTotal').textContent = pending;
  document.getElementById('cookingTotal').textContent = cooking;
  document.getElementById('readyTotal').textContent = ready;
  
  renderStation('housekeeping', 'foodTickets', 'foodTicketCount');
  renderStation('dining', 'drinkTickets', 'drinkTicketCount');
}

async function loadOrders() {
  orders = (await api('/api/orders')).orders;
  renderKitchen();
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-order][data-station]');
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/orders/${encodeURIComponent(button.dataset.order)}/station`, {
      method: 'PATCH',
      body: JSON.stringify({ station: button.dataset.station, status: button.dataset.status })
    });
    await loadOrders();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});

document.querySelectorAll('[data-kds-filter]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-kds-filter]').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    currentFilter = button.dataset.kdsFilter;
    renderKitchen();
  });
});

document.getElementById('logoutButton')?.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.replace('/index.html');
});

(async () => {
  try {
    await loadOrders();
    previousOrderIds = new Set(orders.map(order => order.id));
    const conn = document.getElementById('connectionState');
    if (conn) {
      conn.textContent = '● Đang đồng bộ trực tiếp';
      conn.classList.add('connected');
    }
    const events = new EventSource(apiUrl('/api/events'), { withCredentials: true });
    events.addEventListener('order', event => {
      const order = JSON.parse(event.data);
      const isNew = !previousOrderIds.has(order.id);
      if (isNew) playAlert();
      previousOrderIds.add(order.id);
      const index = orders.findIndex(item => item.id === order.id);
      if (index < 0) orders.unshift(order);
      else orders[index] = order;
      renderKitchen();
    });
    events.onerror = () => {
      const conn = document.getElementById('connectionState');
      if (conn) {
        conn.textContent = 'Đang khôi phục kết nối…';
        conn.classList.remove('connected');
      }
    };
  } catch (error) {
    const conn = document.getElementById('connectionState');
    if (conn) conn.textContent = error.message;
  }
})();
