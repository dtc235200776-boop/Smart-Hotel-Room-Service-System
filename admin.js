const money = value => Number(value || 0) === 0 ? '0đ' : `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const localDateKey = value => value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
const API_BASE = '';
const apiUrl = path => `${API_BASE}${path}`;
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

let orders = [];
let billView = 'unpaid';
let rooms = [];
let inventory = [];
let reservations = [];
let roomReceipts = [];

async function api(url, options = {}) {
  const response = await fetch(apiUrl(url), { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const result = response.status === 204 ? {} : await response.json();
  if (response.status === 401) { location.replace(`/staff-login.html?next=${encodeURIComponent(location.pathname)}`); throw new Error('Cần đăng nhập nhân viên khách sạn.'); }
  if (!response.ok) throw new Error(result.error || 'Không thể kết nối máy chủ.');
  return result;
}

function renderReceipt(order) {
  const receipt = document.getElementById('receiptPrint');
  const amountToPay = order.amountPaid ?? order.totalPrice;
  receipt.innerHTML = `
    <h2>GOLDEN HAVEN &amp; Resort</h2>
    <p>${order.status === 'paid' ? 'HÓA ĐƠN QUYẾT TOÁN DỊCH VỤ PHÒNG (CHECK-OUT)' : 'PHIẾU TẠM TÍNH DỊCH VỤ PHÒNG'}</p>
    <p>${safe(order.table)} · Mã phiếu: ${safe(order.id)}</p>
    <p>Thời gian: ${new Date(order.createdAt).toLocaleString('vi-VN')}</p>
    <hr>${order.items.map(item => `<p>${item.qty} × ${safe(item.name)}　${money(item.total)}</p>${item.salePercent ? `<small>Ưu đãi phòng: -${item.salePercent}%</small>` : ''}${item.note ? `<small>Ghi chú: ${safe(item.note)}</small>` : ''}`).join('')}
    <hr>
    <p>Tổng tiền dịch vụ: ${money(order.totalPrice)}</p>
    ${order.voucherDiscount ? `<p>Ưu đãi ${safe(order.voucherCode)}: -${money(order.voucherDiscount)}</p>` : ''}
    <p class="receipt-total">Thanh toán: ${money(amountToPay)}</p>
    ${order.paidAt ? `<p>Thu tiền: ${new Date(order.paidAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>` : ''}
    <p>Kính chúc quý khách có kỳ nghỉ đáng nhớ tại GOLDEN HAVEN!</p>`;
  window.print();
}
window.printOrder = id => { const order = orders.find(item => item.id === id); if (order) renderReceipt(order); };

function renderBills() {
  const view = orders.filter(order => {
    if (billView === 'cancelled' || billView === 'paid') return order.status === billView;
    return !['paid', 'cancelled'].includes(order.status);
  });
  document.getElementById('billsList').innerHTML = view.length ? view.map(order => {
    const paid = order.status === 'paid';
    const isCancelled = order.status === 'cancelled';
    const waitingItems = order.items.filter(item => order.stations?.[item.section === 'dining' ? 'dining' : 'housekeeping'] !== 'ready');
    const waitingDepartments = [...new Set(waitingItems.map(item => item.section === 'dining' ? 'Bếp' : 'Buồng phòng'))];
    const serviceState = paid ? 'Đã thanh toán' : isCancelled ? 'Đã hủy' : waitingDepartments.length ? `Chờ ${waitingDepartments.join(' & ')} hoàn tất` : 'Dịch vụ hoàn tất · chờ thu tiền';
    const waitingTitle = waitingItems.length ? `Chưa hoàn tất: ${waitingItems.map(item => item.name).join(', ')}` : '';
    const items = order.items.map(item => `<li><span>${item.qty} × ${safe(item.name)}${item.note ? `<small> · ${safe(item.note)}</small>` : ''}${item.salePercent ? `<small class="sale-inline"> · giảm ${item.salePercent}%</small>` : ''}</span><b>${money(item.total)}</b></li>`).join('');
    const voucher = paid
      ? `<div class="paid-summary">${order.voucherCode ? `Mã ưu đãi ${safe(order.voucherCode)} · giảm ${money(order.voucherDiscount)}` : 'Không dùng mã giảm'}<strong>Đã quyết toán ${money(order.amountPaid ?? order.totalPrice)}</strong></div>`
      : isCancelled
      ? `<div class="paid-summary" style="color:#dc2626;"><strong>ĐÃ HỦY YÊU CẦU NÀY</strong></div>`
      : `<label class="voucher-field">Mã ưu đãi phòng<input data-voucher-for="${safe(order.id)}" placeholder="Nhập mã nếu có (VD: HOTEL10)" autocomplete="off"></label><div class="payment-summary"><span>Tạm tính dịch vụ</span><b>${money(order.totalPrice)}</b><small>Khoản này sẽ gộp vào hóa đơn phòng</small></div>`;
    const action = paid
      ? `<button class="receipt-button" data-print="${safe(order.id)}">In phiếu quyết toán</button>`
      : isCancelled
      ? `<span style="font-size:12px; color:#94a3b8;">Không phát sinh chi phí</span>`
      : `<div class="bill-actions" style="display:flex; flex-wrap:wrap; gap:6px;">
           ${order.status === 'pending' ? `<button type="button" class="cancel-button" data-cancel="${safe(order.id)}">Hủy</button>` : ''}
           ${waitingDepartments.length ? '' : `<button type="button" class="receipt-button requires-vietqr" data-vietqr="${safe(order.id)}">Mã VietQR</button>`}
           <button class="pay-button" data-pay="${safe(order.id)}" ${!['ready', 'served'].includes(order.status) ? `disabled title="${safe(waitingTitle || 'Chờ bộ phận phục vụ hoàn tất dịch vụ')}"` : ''}>${waitingDepartments.length ? `Chờ ${safe(waitingDepartments.join(' & '))}` : 'Xác nhận thanh toán'}</button>
           ${waitingDepartments.length ? '<a href="/bo-phan.html" style="font-size:12px; align-self:center;">Mở cổng bộ phận →</a>' : ''}
         </div>`;
    const state = serviceState;
    return `
      <article class="bill-card ${paid ? 'bill-paid' : ''} ${isCancelled ? 'cancelled' : ''}">
        <header>
          <div>
            <strong>${safe(order.table)}</strong>
            <small>#${safe(order.id)} · ${new Date(order.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small>
          </div>
          <span class="status-pill ${paid ? 'paid' : order.status}" title="${safe(waitingTitle)}">${safe(state)}</span>
        </header>
        <ul>${items}</ul>
        ${voucher}
        <footer>
          <b>${paid ? 'Đã thu tiền' : isCancelled ? 'Hủy bỏ' : waitingDepartments.length ? 'Cần hoàn tất dịch vụ' : 'Chờ thanh toán'}</b>
          ${action}
        </footer>
      </article>`;
  }).join('') : '<p class="admin-empty">Không có yêu cầu dịch vụ trong mục này.</p>';
}

function renderReports(paidOrders) {
  const daily = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(Date.now() - (6 - offset) * 86400000);
    const key = localDateKey(date);
    const amount = paidOrders.filter(order => localDateKey(order.paidAt) === key).reduce((sum, order) => sum + (order.amountPaid ?? order.totalPrice), 0)
      + roomReceipts.filter(receipt => localDateKey(receipt.paidAt) === key).reduce((sum, receipt) => sum + receipt.room.roomTotal, 0);
    return { label: date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }), amount };
  });
  const maximum = Math.max(...daily.map(day => day.amount), 1);
  const chart = document.getElementById('revenueChart'); if (!chart) return;
  chart.innerHTML = daily.map(day => `<div class="chart-col"><strong>${day.amount ? money(day.amount) : ''}</strong><i style="height:${Math.max(day.amount ? 8 : 3, day.amount / maximum * 100)}%"></i><span>${day.label}</span></div>`).join('');
  const popular = new Map(); paidOrders.forEach(order => order.items.forEach(item => popular.set(item.name, (popular.get(item.name) || 0) + item.qty)));
  const top = [...popular.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  document.getElementById('topItems').innerHTML = top.length ? top.map(([name, qty]) => `<li><span>${safe(name)}</span><b>${qty} lượt</b></li>`).join('') : '<li>Chưa có dữ liệu quyết toán</li>';
}

function renderInventory() {
  const root = document.getElementById('inventoryGrid'); if (!root) return;
  const low = inventory.filter(item => item.quantity <= item.minimum);
  document.getElementById('inventoryLowCount').textContent = `${low.length} mặt hàng cần bổ sung`;
  document.getElementById('inventoryAlerts').innerHTML = low.map(item => `<span class="inventory-alert">Cần nhập ${safe(item.name)} · còn ${item.quantity} ${safe(item.unit)}</span>`).join('');
  root.innerHTML = inventory.map(item => `<article class="inventory-item ${item.quantity <= item.minimum ? 'low' : ''}"><div><strong>${safe(item.name)}</strong><br><small>${safe(item.category)} · Mức tối thiểu ${item.minimum} ${safe(item.unit)}</small></div><div class="inventory-stock"><button aria-label="Giảm tồn ${safe(item.name)}" data-stock="${safe(item.id)}" data-delta="-1">−</button><b>${item.quantity} ${safe(item.unit)}</b><button aria-label="Tăng tồn ${safe(item.name)}" data-stock="${safe(item.id)}" data-delta="1">+</button></div></article>`).join('');
}

function renderManagerTasks(unpaid) {
  const target = document.getElementById('managerTasks'); if (!target) return;
  const tasks = [];
  const cleaning = rooms.filter(room => room.status === 'cleaning').length;
  const maintenance = rooms.filter(room => room.status === 'maintenance').length;
  const pendingBookings = reservations.filter(row => String(row.status).toLowerCase() === 'pending').length;
  const readyBills = unpaid.filter(order => ['ready', 'served'].includes(order.status)).length;
  const low = inventory.filter(item => item.quantity <= item.minimum);
  if (cleaning) tasks.push(`Điều phối buồng phòng dọn ${cleaning} phòng vừa trả.`);
  if (maintenance) tasks.push(`Theo dõi ${maintenance} phòng đang bảo trì; chưa phân khách vào các phòng này.`);
  if (pendingBookings) tasks.push(`Tiếp tân cần xử lý ${pendingBookings} yêu cầu đặt phòng đang chờ xác nhận.`);
  if (readyBills) tasks.push(`Thu ngân có ${readyBills} hóa đơn dịch vụ sẵn sàng quyết toán.`);
  if (low.length) tasks.push(`Bổ sung tồn kho: ${low.map(item => item.name).join(', ')}.`);
  target.innerHTML = tasks.length ? tasks.map(task => `<li>${safe(task)}</li>`).join('') : '<li class="task-ok">Chưa có việc tồn đọng · phòng, dịch vụ và vật tư đang trong mức theo dõi.</li>';
}

function renderAdmin() {
  const unpaid = orders.filter(order => !['paid', 'cancelled'].includes(order.status));
  const paid = orders.filter(order => order.status === 'paid');
  const today = localDateKey(new Date());
  const todayPaid = paid.filter(order => localDateKey(order.paidAt) === today);
  const roomRevenue = roomReceipts.filter(receipt => localDateKey(receipt.paidAt) === today).reduce((sum, receipt) => sum + receipt.room.roomTotal, 0);
  const revenue = roomRevenue + todayPaid.reduce((sum, order) => sum + (order.amountPaid ?? order.totalPrice), 0);
  document.getElementById('revenueStat').textContent = money(revenue);
  document.getElementById('revenueOrderCount').textContent = document.getElementById('tablesGrid')
    ? `Tiền phòng ${money(roomRevenue)} · ${todayPaid.length} đơn dịch vụ đã thu` : `${todayPaid.length} lượt phục vụ hôm nay`;
  document.getElementById('unpaidStat').textContent = unpaid.filter(order => ['ready', 'served'].includes(order.status)).length;
  const activeTables = new Set(unpaid.map(order => order.table));
  const occupied = rooms.length ? rooms.filter(room => room.status === 'occupied').length : activeTables.size;
  document.getElementById('occupiedStat').textContent = `${occupied} / ${rooms.length || 12}`;
  
  const roomGrid = document.getElementById('tablesGrid');
  if (roomGrid) roomGrid.innerHTML = (rooms.length ? rooms : Array.from({ length: 12 }, (_, index) => ({ number: 101 + index, status: 'available' }))).map(room => {
    const number = room.number;
    const open = unpaid.filter(order => order.table === `Phòng ${number}`);
    const statusLabels = { available: 'Phòng trống · sẵn sàng nhận khách', occupied: `${safe(room.guestName)} · trả ${safe(room.plannedCheckout)}`, cleaning: 'Đang chờ buồng phòng dọn', maintenance: 'Tạm ngừng nhận khách · bảo trì' };
    const statusIcons = { available: '✓', occupied: '●', cleaning: '🧹', maintenance: '⚒' };
    return `
      <a class="table-tile ${room.status}" href="/letan.html?room=${number}" title="Mở thông tin ${`Phòng ${number}`} trên màn hình tiếp tân">
        <span class="table-icon">${statusIcons[room.status] || '•'}</span>
        <strong>Phòng ${number}</strong>
        <span>${statusLabels[room.status] || room.status}${open.length ? ` · ${open.length} yêu cầu dịch vụ` : ''}</span>
      </a>`;
  }).join('');
  renderBills(); if (document.getElementById('revenueChart')) renderReports(paid);
  renderInventory(); renderManagerTasks(unpaid);
}

async function loadOrders() {
  const requests = [api('/api/orders')];
  if (document.getElementById('tablesGrid')) requests.push(api('/api/rooms'), api('/api/inventory'), api('/api/reservations'), api('/api/folios'));
  const results = await Promise.all(requests); orders = results[0].orders;
  if (results.length > 1) {
    rooms = results[1].rooms;
    inventory = results[2].items;
    reservations = results[3].reservations;
    roomReceipts = results[4].receipts;
  }
  renderAdmin();
}
document.getElementById('billsList').addEventListener('click', async event => {
  const qrBtn = event.target.closest('[data-vietqr]');
  if (qrBtn) {
    const id = qrBtn.dataset.vietqr;
    const order = orders.find(o => o.id === id);
    if (!order) return;
    const modal = document.getElementById('cashierVietqrModal');
    if (!modal) return;
    const code = document.querySelector(`[data-voucher-for="${CSS.escape(id)}"]`)?.value.trim();
    if (code) return alert('Nếu dùng ưu đãi, hãy đối chiếu số tiền sau ưu đãi và thu tại quầy.');
    const qr = await HotelPayment.getQr(order.totalPrice, `THANHTOAN ${order.table} ${order.id}`);
    if (!qr) return;
    document.getElementById('cashierVietqrTitle').textContent = `VietQR · ${order.table} (#${order.id})`;
    document.getElementById('cashierVietqrImg').src = qr.url;
    document.getElementById('cashierVietqrBank').textContent = qr.bankLabel;
    document.getElementById('cashierVietqrAmount').textContent = money(order.totalPrice);
    document.getElementById('cashierVietqrMemo').textContent = `Nội dung: ${qr.memo}`;
    modal.hidden = false;
    return;
  }

  const cancelBtn = event.target.closest('[data-cancel]');
  if (cancelBtn) {
    const id = cancelBtn.dataset.cancel;
    if (!confirm(`Bạn có chắc chắn muốn HỦY đơn dịch vụ #${id} không?`)) return;
    cancelBtn.disabled = true;
    try {
      await api(`/api/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      await loadOrders();
    } catch (error) {
      alert(error.message);
      cancelBtn.disabled = false;
    }
    return;
  }

  const print = event.target.closest('[data-print]'); if (print) return window.printOrder(print.dataset.print);
  const button = event.target.closest('[data-pay]'); if (!button) return;
  const id = button.dataset.pay; const input = document.querySelector(`[data-voucher-for="${CSS.escape(id)}"]`); button.disabled = true;
  try {
    await api(`/api/orders/${encodeURIComponent(id)}/pay`, { method: 'POST', body: JSON.stringify({ voucherCode: input?.value || '' }) });
    document.querySelector('[data-bill-view="paid"]')?.click();
    await loadOrders();
  }
  catch (error) { alert(error.message); button.disabled = false; }
});
document.getElementById('closeCashierVietqrBtn')?.addEventListener('click', () => {
  const modal = document.getElementById('cashierVietqrModal');
  if (modal) modal.hidden = true;
});
document.getElementById('cashierVietqrModal')?.addEventListener('click', event => {
  if (event.target.id === 'cashierVietqrModal') event.target.hidden = true;
});
document.getElementById('inventoryGrid')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-stock]'); if (!button) return;
  button.disabled = true;
  try {
    const item = inventory.find(row => row.id === button.dataset.stock); if (!item) return;
    const quantity = Math.max(0, item.quantity + Number(button.dataset.delta));
    await api(`/api/inventory/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ quantity }) });
    inventory = (await api('/api/inventory')).items; renderInventory(); renderManagerTasks(orders.filter(order => order.status !== 'paid'));
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
});
document.querySelectorAll('[data-bill-view]').forEach(button => button.addEventListener('click', () => { billView = button.dataset.billView; document.querySelectorAll('[data-bill-view]').forEach(tab => tab.classList.toggle('active', tab === button)); renderBills(); }));
document.getElementById('cashierLogout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.replace('/bo-phan.html'); });

(async () => {
  try {
    await loadOrders(); document.getElementById('cashierConnection').textContent = '● Đang đồng bộ trực tiếp'; document.getElementById('cashierConnection').classList.add('connected');
    const events = new EventSource(apiUrl('/api/events'), { withCredentials: true });
    events.addEventListener('order', event => {
      const order = JSON.parse(event.data);
      const index = orders.findIndex(item => item.id === order.id);
      if (index < 0) orders.unshift(order); else orders[index] = order;
      renderAdmin();
      window.dispatchEvent(new Event('hotel-billing-updated'));
      if (document.getElementById('tablesGrid')) api('/api/inventory').then(data => {
        inventory = data.items;
        renderInventory();
        renderManagerTasks(orders.filter(order => !['paid', 'cancelled'].includes(order.status)));
      }).catch(console.error);
    });
    events.addEventListener('folio', () => {
      window.dispatchEvent(new Event('hotel-billing-updated'));
      if (document.getElementById('tablesGrid')) loadOrders().catch(console.error);
    });
    events.onopen = () => {
      document.getElementById('cashierConnection').textContent = '● Đang đồng bộ trực tiếp';
      document.getElementById('cashierConnection').classList.add('connected');
      loadOrders().catch(console.error);
      window.dispatchEvent(new Event('hotel-billing-updated'));
    };
    events.onerror = () => { document.getElementById('cashierConnection').textContent = 'Đang khôi phục kết nối…'; document.getElementById('cashierConnection').classList.remove('connected'); };
  } catch (error) { document.getElementById('cashierConnection').textContent = error.message; }
})();
