const money = value => Number(value || 0) === 0 ? '0đ' : `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const API_BASE = (location.port === '5500') ? `${location.protocol}//${location.hostname}:3000` : '';
const apiUrl = path => `${API_BASE}${path}`;
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let orders = [];
let billView = 'unpaid';
let selectedRoomFilter = null;

async function api(url, options = {}) {
  const response = await fetch(apiUrl(url), { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const result = response.status === 204 ? {} : await response.json();
  if (response.status === 401) { location.replace(`/staff-login.html?next=${encodeURIComponent('/admin.html')}`); throw new Error('Cần đăng nhập nhân viên lễ tân.'); }
  if (!response.ok) throw new Error(result.error || 'Không thể kết nối máy chủ.');
  return result;
}

function renderReceipt(order) {
  const receipt = document.getElementById('receiptPrint');
  receipt.innerHTML = `
    <h2>Grand Cloud Hotel &amp; Resort</h2>
    <p>${order.status === 'paid' ? 'HÓA ĐƠN QUYẾT TOÁN DỊCH VỤ PHÒNG (CHECK-OUT)' : 'PHIẾU TẠM TÍNH DỊCH VỤ PHÒNG'}</p>
    <p>${safe(order.table)} · Mã phiếu: ${safe(order.id)}</p>
    <p>Thời gian: ${new Date(order.createdAt).toLocaleString('vi-VN')}</p>
    <hr>${order.items.map(item => `<p>${item.qty} × ${safe(item.name)}　${money(item.total)}</p>${item.salePercent ? `<small>Ưu đãi phòng: -${item.salePercent}%</small>` : ''}${item.note ? `<small>Ghi chú: ${safe(item.note)}</small>` : ''}`).join('')}
    <hr>
    <p>Tổng tiền dịch vụ: ${money(order.totalPrice)}</p>
    ${order.voucherDiscount ? `<p>Ưu đãi ${safe(order.voucherCode)}: -${money(order.voucherDiscount)}</p>` : ''}
    <p class="receipt-total">Thanh toán: ${money(order.amountPaid ?? order.totalPrice)}</p>
    <p>Kính chúc quý khách có kỳ nghỉ đáng nhớ tại Grand Cloud Hotel!</p>`;
  window.print();
}
window.printOrder = id => { const order = orders.find(item => item.id === id); if (order) renderReceipt(order); };

function renderBills() {
  let view = orders.filter(order => {
    if (order.status === 'cancelled') return billView === 'unpaid'; // show cancelled in list or hide
    return billView === 'paid' ? order.status === 'paid' : order.status !== 'paid';
  });

  if (selectedRoomFilter) {
    view = view.filter(order => order.table === selectedRoomFilter);
  }

  document.getElementById('billsList').innerHTML = view.length ? view.map(order => {
    const paid = order.status === 'paid';
    const isCancelled = order.status === 'cancelled';
    const items = order.items.map(item => `<li><span>${item.qty} × ${safe(item.name)}${item.note ? `<small> · ${safe(item.note)}</small>` : ''}${item.salePercent ? `<small class="sale-inline"> · giảm ${item.salePercent}%</small>` : ''}</span><b>${money(item.total)}</b></li>`).join('');
    
    let voucher = '';
    if (paid) {
      voucher = `<div class="paid-summary">${order.voucherCode ? `Mã ưu đãi ${safe(order.voucherCode)} · giảm ${money(order.voucherDiscount)}` : 'Không dùng mã giảm'}<strong>Đã quyết toán ${money(order.amountPaid ?? order.totalPrice)}</strong></div>`;
    } else if (isCancelled) {
      voucher = `<div class="paid-summary" style="color:#dc2626;"><strong>ĐÃ HỦY YÊU CẦU NÀY</strong></div>`;
    } else {
      voucher = `<label class="voucher-field">Mã ưu đãi phòng<input data-voucher-for="${safe(order.id)}" placeholder="Nhập mã nếu có (VD: HOTEL10)" autocomplete="off"></label><div class="payment-summary"><span>Tạm tính dịch vụ</span><b>${money(order.totalPrice)}</b><small>Khoản này sẽ gộp vào hóa đơn phòng</small></div>`;
    }

    let actions = '';
    if (paid) {
      actions = `<button class="receipt-button" data-print="${safe(order.id)}">In phiếu quyết toán</button>`;
    } else if (isCancelled) {
      actions = `<span style="font-size:12px; color:#94a3b8;">Không phát sinh chi phí</span>`;
    } else {
      actions = `
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="cancel-button" data-cancel="${safe(order.id)}" title="Hủy bỏ yêu cầu này nếu khách đổi ý">Hủy đơn</button>
          <button class="pay-button" data-pay="${safe(order.id)}" data-status="${safe(order.status)}">Quyết toán Check-out</button>
        </div>
      `;
    }

    const state = paid ? 'Đã quyết toán' : isCancelled ? 'Đã hủy' : ({ pending: 'Lễ tân đã nhận', cooking: 'Đang phục vụ', ready: 'Đã hoàn tất phục vụ', served: 'Đã phục vụ' }[order.status] || 'Đang xử lý');
    
    return `
      <article class="bill-card ${paid ? 'bill-paid' : ''} ${isCancelled ? 'cancelled' : ''}">
        <header>
          <div>
            <strong>${safe(order.table)}</strong>
            <small>#${safe(order.id)} · ${new Date(order.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small>
          </div>
          <span class="status-pill ${paid ? 'paid' : order.status}">${state}</span>
        </header>
        <ul>${items}</ul>
        ${voucher}
        <footer>
          <b>${paid ? 'Hoàn tất' : isCancelled ? 'Hủy bỏ' : 'Lễ tân'}</b>
          ${actions}
        </footer>
      </article>`;
  }).join('') : `<p class="admin-empty">${selectedRoomFilter ? `Không có yêu cầu dịch vụ nào cho ${selectedRoomFilter}.` : 'Không có yêu cầu dịch vụ trong mục này.'}</p>`;
}

function renderReports(paidOrders) {
  const daily = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - offset)); const key = date.toLocaleDateString('en-CA');
    const amount = paidOrders.filter(order => (order.paidAt || '').slice(0, 10) === key).reduce((sum, order) => sum + (order.amountPaid ?? order.totalPrice), 0);
    return { label: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }), amount };
  });
  const maximum = Math.max(...daily.map(day => day.amount), 1);
  document.getElementById('revenueChart').innerHTML = daily.map(day => `<div class="chart-col"><strong>${day.amount ? money(day.amount) : ''}</strong><i style="height:${Math.max(day.amount ? 8 : 3, day.amount / maximum * 100)}%"></i><span>${day.label}</span></div>`).join('');
  const popular = new Map(); paidOrders.forEach(order => order.items.forEach(item => popular.set(item.name, (popular.get(item.name) || 0) + item.qty)));
  const top = [...popular.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  document.getElementById('topItems').innerHTML = top.length ? top.map(([name, qty]) => `<li><span>${safe(name)}</span><b>${qty} lượt</b></li>`).join('') : '<li>Chưa có dữ liệu quyết toán</li>';
}

function renderAdmin() {
  const unpaid = orders.filter(order => order.status !== 'paid' && order.status !== 'cancelled');
  const paid = orders.filter(order => order.status === 'paid');
  const today = new Date().toLocaleDateString('en-CA');
  const todayPaid = paid.filter(order => (order.paidAt || '').slice(0, 10) === today);
  const revenue = todayPaid.reduce((sum, order) => sum + (order.amountPaid ?? order.totalPrice), 0);
  
  document.getElementById('revenueStat').textContent = money(revenue);
  document.getElementById('revenueOrderCount').textContent = `${todayPaid.length} lượt phục vụ hôm nay`;
  document.getElementById('unpaidStat').textContent = unpaid.filter(order => ['ready', 'served'].includes(order.status)).length;
  
  const activeTables = new Set(unpaid.map(order => order.table));
  document.getElementById('occupiedStat').textContent = `${activeTables.size} / 12`;
  
  // 12 phòng từ Phòng 101 đến Phòng 112
  document.getElementById('tablesGrid').innerHTML = Array.from({ length: 12 }, (_, index) => {
    const room = `Phòng ${101 + index}`;
    const open = unpaid.filter(order => order.table === room);
    const isSelected = selectedRoomFilter === room;
    return `
      <article class="table-tile ${open.length ? 'occupied' : 'free'} ${isSelected ? 'filter-selected' : ''}" data-room="${safe(room)}">
        <span class="table-icon">${open.length ? '●' : '✓'}</span>
        <strong>${room}</strong>
        <span>${open.length ? `${open.length} yêu cầu · ${money(open.reduce((sum, order) => sum + order.totalPrice, 0))}` : 'Phòng trống'}</span>
      </article>`;
  }).join('');

  const badge = document.getElementById('selectedRoomBadge');
  if (badge) {
    if (selectedRoomFilter) {
      badge.style.display = 'inline-flex';
      document.getElementById('selectedRoomText').textContent = selectedRoomFilter;
    } else {
      badge.style.display = 'none';
    }
  }

  renderBills();
  renderReports(paid);
}

async function loadOrders() {
  orders = (await api('/api/orders')).orders;
  renderAdmin();
}

// Bấm vào ô phòng để lọc nhanh hóa đơn
document.getElementById('tablesGrid').addEventListener('click', event => {
  const tile = event.target.closest('[data-room]');
  if (!tile) return;
  const room = tile.dataset.room;
  selectedRoomFilter = (selectedRoomFilter === room) ? null : room;
  renderAdmin();
});

document.getElementById('btnClearRoomFilter')?.addEventListener('click', () => {
  selectedRoomFilter = null;
  renderAdmin();
});

document.getElementById('billsList').addEventListener('click', async event => {
  const print = event.target.closest('[data-print]');
  if (print) return window.printOrder(print.dataset.print);

  const cancelButton = event.target.closest('[data-cancel]');
  if (cancelButton) {
    const id = cancelButton.dataset.cancel;
    if (!confirm(`Bạn có chắc chắn muốn HỦY đơn dịch vụ #${id} không?`)) return;
    cancelButton.disabled = true;
    try {
      await api(`/api/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      await loadOrders();
    } catch (error) {
      alert(error.message);
      cancelButton.disabled = false;
    }
    return;
  }

  const payButton = event.target.closest('[data-pay]');
  if (!payButton) return;
  const id = payButton.dataset.pay;
  const order = orders.find(o => o.id === id);
  if (!order) return;

  if (!['ready', 'served'].includes(order.status)) {
    const confirmed = confirm(`Dịch vụ của ${order.table} đang ở trạng thái "${order.status === 'cooking' ? 'Đang phục vụ' : 'Chờ tiếp nhận'}".\nKhách muốn thanh toán sớm và bạn đồng ý quyết toán luôn không?`);
    if (!confirmed) return;
  }

  const input = document.querySelector(`[data-voucher-for="${CSS.escape(id)}"]`);
  payButton.disabled = true;
  try {
    await api(`/api/orders/${encodeURIComponent(id)}/pay`, {
      method: 'POST',
      body: JSON.stringify({ voucherCode: input?.value || '' })
    });
    await loadOrders();
  } catch (error) {
    alert(error.message);
    payButton.disabled = false;
  }
});

document.querySelectorAll('[data-bill-view]').forEach(button => {
  button.addEventListener('click', () => {
    billView = button.dataset.billView;
    document.querySelectorAll('[data-bill-view]').forEach(tab => tab.classList.toggle('active', tab === button));
    renderBills();
  });
});

document.getElementById('cashierLogout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.replace('/index.html');
});

(async () => {
  try {
    await loadOrders();
    const conn = document.getElementById('cashierConnection');
    if (conn) {
      conn.textContent = '● Đang đồng bộ trực tiếp';
      conn.classList.add('connected');
    }
    const events = new EventSource(apiUrl('/api/events'), { withCredentials: true });
    events.addEventListener('order', event => {
      const order = JSON.parse(event.data);
      const index = orders.findIndex(item => item.id === order.id);
      if (index < 0) orders.unshift(order);
      else orders[index] = order;
      renderAdmin();
    });
    events.onerror = () => {
      const conn = document.getElementById('cashierConnection');
      if (conn) {
        conn.textContent = 'Đang khôi phục kết nối…';
        conn.classList.remove('connected');
      }
    };
  } catch (error) {
    const conn = document.getElementById('cashierConnection');
    if (conn) conn.textContent = error.message;
  }
})();
