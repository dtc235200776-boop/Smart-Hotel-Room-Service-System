// ==========================================================================
// GOLDEN HAVEN - Phân hệ Tiếp tân / Lễ tân & Quản lý QR Phòng
// File: letan.js
// ==========================================================================

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = value => `${Number(value || 0).toLocaleString('vi-VN')}đ`;

let receptionOrders = [];
let roomsList = [];
let currentFolioData = null;

// ==========================================================================
// 1. Quản lý Hóa đơn Dịch vụ phòng chờ thu
// ==========================================================================
async function loadReceptionOrders() {
  const target = document.getElementById('receptionBillsList');
  if (!target) return;
  try {
    const response = await fetch('/api/orders', { credentials: 'include', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không tải được hóa đơn.');
    receptionOrders = data.orders || [];
    const unpaid = receptionOrders.filter(order => !['paid', 'cancelled'].includes(order.status));

    target.innerHTML = unpaid.length ? unpaid.map(order => {
      const ready = ['ready', 'served'].includes(order.status);
      const state = ready ? 'Dịch vụ đã hoàn tất · sẵn sàng thu tiền' : 'Đang chờ bếp / buồng phòng phục vụ';
      return `
        <article class="reception-bill">
          <header>
            <div>
              <strong>${escapeHtml(order.table)}</strong>
              <small>#${escapeHtml(order.id)} · ${new Date(order.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
            <b>${money(order.totalPrice)}</b>
          </header>
          <ul>${order.items.map(item => `<li>${item.qty} × ${escapeHtml(item.name)}</li>`).join('')}</ul>
          <small style="color:${ready ? '#15803d' : '#b45309'}; font-weight:600;">${state}</small>
          <footer>
            <div style="display:flex; gap:6px; width:100%;">
              ${ready ? `<button type="button" class="btn-vietqr requires-vietqr" data-vietqr-order="${escapeHtml(order.id)}">Mã VietQR</button>` : ''}
              <button data-reception-pay="${escapeHtml(order.id)}" ${ready ? '' : 'disabled'} style="flex:1;">Xác nhận thu</button>
            </div>
          </footer>
        </article>`;
    }).join('') : '<p style="color:#64748b;">Không còn hóa đơn dịch vụ chờ thu.</p>';
  } catch (error) {
    target.textContent = error.message;
  }
}

// Lắng nghe sự kiện trên danh sách hóa đơn dịch vụ
document.getElementById('receptionBillsList')?.addEventListener('click', async event => {
  // Nút mở VietQR cho đơn dịch vụ
  const qrBtn = event.target.closest('[data-vietqr-order]');
  if (qrBtn) {
    const orderId = qrBtn.dataset.vietqrOrder;
    const order = receptionOrders.find(o => o.id === orderId);
    if (!order) return;
    openVietQrModal({
      title: `Thanh toán ${order.table} · Đơn #${order.id}`,
      amount: order.totalPrice,
      description: `THANHTOAN ${order.table.replace(/\s+/g, '')} ${order.id.slice(-6)}`
    });
    return;
  }

  // Nút xác nhận đã thu tiền mặt
  const payBtn = event.target.closest('[data-reception-pay]');
  if (!payBtn) return;
  payBtn.disabled = true;
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(payBtn.dataset.receptionPay)}/pay`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voucherCode: '' })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thể xác nhận thanh toán.');
    await loadReceptionOrders();
    await loadRooms();
  } catch (error) {
    alert(error.message);
    payBtn.disabled = false;
  }
});

// ==========================================================================
// 2. Quản lý Sơ đồ phòng & Thủ tục Check-in / Check-out gộp tiền
// ==========================================================================
const roomLabels = {
  available: 'Phòng trống',
  occupied: 'Đang lưu trú',
  cleaning: 'Chờ dọn phòng',
  maintenance: 'Đang bảo trì'
};
const roomGrid = document.getElementById('roomStatusGrid');
const checkinBackdrop = document.getElementById('checkinBackdrop');
const checkinForm = document.getElementById('checkinForm');

function openCheckin(number) {
  checkinForm.elements.roomNumber.value = number;
  const room = roomsList.find(r => r.number === Number(number));
  const typeText = room ? ` (${room.typeLabel || 'Tiêu chuẩn'} · ${money(room.pricePerNight)}/đêm)` : '';
  document.getElementById('checkinRoomLabel').textContent = `Phòng ${number}${typeText} · nhập thông tin lưu trú`;
  const tomorrow = new Date(Date.now() + 86400000);
  checkinForm.elements.plannedCheckout.min = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  checkinForm.elements.plannedCheckout.value = checkinForm.elements.plannedCheckout.min;
  checkinBackdrop.hidden = false;
  checkinForm.elements.guestName.focus();
}

async function roomAction(number, action) {
  const response = await fetch(`/api/rooms/${number}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Không thể cập nhật phòng.');
  await loadRooms();
}

// Mở Hóa đơn Quyết toán Tổng hợp khi Check-out
function showCheckoutFolio(data) {
  currentFolioData = data;
  const target = document.getElementById('checkoutFolioDetails');
  const reference = data.id ? ` · ${HotelFolio.safe(data.id)}` : '';
  target.innerHTML = `
    <h3>Phòng ${data.room.number}${reference}</h3>
    ${HotelFolio.detail(data)}
    ${data.id ? '' : `<label class="folio-method">Phương thức thanh toán
      <select id="checkoutPaymentMethod">${HotelFolio.options()}</select>
    </label>`}
  `;
  if (!data.id && data.amountDue > 0 && data.canCheckOut) {
    const payment = document.createElement('button');
    payment.type = 'button';
    payment.className = 'receipt-button requires-vietqr';
    payment.textContent = 'Mở VietQR thanh toán';
    payment.addEventListener('click', () => openVietQrModal({
      title: `Thanh toán phòng ${data.room.number}`, amount: data.amountDue,
      description: `THANHTOAN PHONG ${data.room.number}`
    }));
    target.append(payment);
  }
  const confirmButton = document.getElementById('confirmSettleCheckoutBtn');
  confirmButton.hidden = Boolean(data.checkedOutAt);
  confirmButton.disabled = !data.canCheckOut;
  confirmButton.textContent = data.id ? 'Xác nhận trả phòng' : 'Xác nhận đã thu & trả phòng';
  const print = document.getElementById('printCheckoutFolioBtn');
  print.disabled = false;
  print.textContent = data.id ? 'In hóa đơn / Lưu PDF' : 'In phiếu tạm tính';
}

async function openCheckoutFolio(roomNumber, receiptId = '') {
  currentFolioData = null;
  document.getElementById('checkoutFolioBackdrop').hidden = false;
  document.getElementById('confirmSettleCheckoutBtn').disabled = true;
  document.getElementById('printCheckoutFolioBtn').disabled = true;
  const target = document.getElementById('checkoutFolioDetails');
  target.textContent = 'Đang tải phiếu quyết toán…';

  try {
    const url = receiptId ? `/api/folios/${encodeURIComponent(receiptId)}` : `/api/rooms/${roomNumber}/bill`;
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Không tải được phiếu quyết toán.');
    showCheckoutFolio(data);
  } catch (error) {
    target.textContent = error.message;
  }
}

async function loadRooms() {
  try {
    const response = await fetch('/api/rooms', { credentials: 'include', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không tải được sơ đồ phòng.');
    roomsList = data.rooms || [];

    roomGrid.innerHTML = roomsList.map(room => {
      const state = roomLabels[room.status] || room.status;
      const pinDisplay = room.pin ? `<span style="display:inline-block; margin-left:6px; padding:1px 6px; background:#fef3c7; color:#92400e; border-radius:4px; font-size:11px; font-weight:700;">PIN: ${room.pin}</span>` : '';
      
      const detail = room.status === 'occupied'
        ? `${escapeHtml(room.guestName)}<br><small>Nhận thực tế: ${room.checkedInAt ? HotelFolio.time(room.checkedInAt) : HotelFolio.day(room.checkIn) + ' · chưa ghi giờ'}<br>Dự kiến trả: ${HotelFolio.day(room.plannedCheckout)}${room.receiptId ? '<br>Đã thu tiền · chờ trả phòng' : ''}</small>`
        : room.status === 'cleaning' && room.lastGuestName
        ? `Khách vừa trả: ${escapeHtml(room.lastGuestName)}<br><small>Trả thực tế: ${HotelFolio.time(room.lastCheckOut)}</small>`
        : `${room.typeLabel || 'Phòng tiêu chuẩn'} · ${money(room.pricePerNight)}/đêm`;

      let actions = '';
      if (room.status === 'available') {
        actions = `
          <div class="room-status-actions">
            <button class="primary" data-checkin="${room.number}">Nhận phòng</button>
            <button data-room-action="maintenance" data-room="${room.number}">Bảo trì</button>
          </div>`;
      }
      if (room.status === 'occupied') {
        actions = `
          <div class="room-status-actions" style="flex-direction:column; gap:4px;">
            <div style="display:flex; gap:4px; width:100%;">
              <button data-show-qr="${room.number}" style="flex:1;">Hiện QR</button>
              <a class="qr-demo-link" href="${getRoomServiceUrl(room.number, room.stayToken)}" target="_blank" rel="noopener" style="flex:1; text-align:center;">Mở thử</a>
            </div>
            <button class="primary" data-checkout-folio="${room.number}" style="width:100%;">
              Quyết toán & Trả phòng →
            </button>
          </div>`;
      }
      if (room.status === 'maintenance') {
        actions = `
          <div class="room-status-actions">
            <button data-room-action="maintenance_done" data-room="${room.number}">Đã sửa xong</button>
          </div>`;
      }
      if (room.status !== 'occupied' && room.lastReceiptId) {
        actions += `<div class="room-status-actions"><button data-receipt="${escapeHtml(room.lastReceiptId)}">Hóa đơn gần nhất</button></div>`;
      }

      return `
        <article class="room-status-card ${room.status}">
          <h3>
            Phòng ${room.number} ${pinDisplay}
            <span class="room-state">${state}</span>
          </h3>
          <p>${detail}</p>
          ${actions}
        </article>`;
    }).join('');

    renderQRCodes();
  } catch (error) {
    roomGrid.textContent = error.message;
  }
}

// Xử lý sự kiện trên lưới phòng
roomGrid.addEventListener('click', async event => {
  const receipt = event.target.closest('[data-receipt]');
  if (receipt) return openCheckoutFolio(null, receipt.dataset.receipt);
  const checkin = event.target.closest('[data-checkin]');
  if (checkin) return openCheckin(checkin.dataset.checkin);

  const qrButton = event.target.closest('[data-show-qr]');
  if (qrButton) return showRoomQr(qrButton.dataset.showQr);

  const folioButton = event.target.closest('[data-checkout-folio]');
  if (folioButton) return openCheckoutFolio(folioButton.dataset.checkoutFolio);

  const button = event.target.closest('[data-room-action]');
  if (!button) return;
  button.disabled = true;
  try {
    await roomAction(button.dataset.room, button.dataset.roomAction);
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});

// Xử lý Check-in vãng lai
document.getElementById('cancelCheckin')?.addEventListener('click', () => {
  checkinBackdrop.hidden = true;
  checkinForm.reset();
});

checkinForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = checkinForm.querySelector('[type="submit"]');
  button.disabled = true;
  const body = Object.fromEntries(new FormData(checkinForm));
  try {
    const response = await fetch(`/api/rooms/${body.roomNumber}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, action: 'check_in' })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thể nhận phòng.');
    checkinBackdrop.hidden = true;
    checkinForm.reset();
    await loadRooms();
    showRoomQr(body.roomNumber);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

// Xử lý xác nhận quyết toán gộp và trả phòng trong Folio Modal
document.getElementById('confirmSettleCheckoutBtn')?.addEventListener('click', async event => {
  const data = currentFolioData;
  if (!data) return;
  const confirmation = data.id
    ? `Xác nhận khách đã trả Phòng ${data.room.number}?`
    : `Xác nhận đã thu ${HotelFolio.money(data.amountDue)} và khách đã trả Phòng ${data.room.number}?`;
  if (!confirm(confirmation)) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch(`/api/rooms/${data.room.number}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'check_out', stayId: data.stayId, settleAll: !data.id, expectedAmount: data.amountDue,
        paymentMethod: document.getElementById('checkoutPaymentMethod')?.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thể trả phòng.');
    showCheckoutFolio(result.receipt);
    await loadReceptionOrders();
    await loadRooms();
    await loadReservations();
  } catch (error) {
    await openCheckoutFolio(data.room.number);
    alert(error.message);
  }
});

document.getElementById('cancelCheckoutFolioBtn')?.addEventListener('click', () => {
  document.getElementById('checkoutFolioBackdrop').hidden = true;
  currentFolioData = null;
});

document.getElementById('printCheckoutFolioBtn')?.addEventListener('click', () => {
  if (currentFolioData) HotelFolio.print(currentFolioData);
});

// ==========================================================================
// 3. Modal VietQR riêng biệt
// ==========================================================================
async function openVietQrModal({ title, amount, description }) {
  const modal = document.getElementById('vietqrBackdrop');
  if (!modal) return;
  const qr = await HotelPayment.getQr(amount, description);
  if (!qr) return;
  document.getElementById('vietqrTitle').textContent = title;
  document.getElementById('vietqrImage').src = qr.url;
  document.getElementById('vietqrAmountText').textContent = money(amount);
  document.getElementById('vietqrBankText').textContent = qr.bankLabel;
  document.getElementById('vietqrMemoText').textContent = `Nội dung: ${qr.memo}`;
  modal.hidden = false;
}

document.getElementById('closeVietQrBtn')?.addEventListener('click', () => {
  document.getElementById('vietqrBackdrop').hidden = true;
});
document.getElementById('vietqrBackdrop')?.addEventListener('click', event => {
  if (event.target.id === 'vietqrBackdrop') document.getElementById('vietqrBackdrop').hidden = true;
});

// ==========================================================================
// 4. Sinh mã QR dịch vụ phòng kèm Token & PIN
// ==========================================================================
let suggestedRoomQrUrl = `${location.origin}/khach-hang.html`;
let roomQrBaseUrl = suggestedRoomQrUrl;

function getRoomServiceUrl(roomNumber, token = '') {
  const url = new URL(roomQrBaseUrl);
  url.search = '';
  url.searchParams.set('room', roomNumber);
  if (token) url.searchParams.set('token', token);
  return url.href;
}

function showRoomQr(roomNumber) {
  const room = roomsList.find(r => r.number === Number(roomNumber));
  const token = room?.stayToken || '';
  const pin = room?.pin || '';
  const url = getRoomServiceUrl(roomNumber, token);

  document.getElementById('guestQrTitle').textContent = `Mã QR dịch vụ · Phòng ${roomNumber}`;
  const pinNote = pin ? `<p style="margin:4px 0 10px; color:#b45309; font-weight:700; font-size:14px;">Mã PIN phòng: <u>${pin}</u></p>` : '';
  const descElem = document.getElementById('guestQrPinDesc');
  if (descElem) descElem.innerHTML = pinNote;

  document.getElementById('guestQrImage').src = createHotelQrImage(url);
  document.getElementById('guestQrOpenLink').href = url;
  document.getElementById('guestQrNetworkNote').textContent = qrNetworkNote(new URL(url));
  document.getElementById('guestQrBackdrop').hidden = false;
  document.getElementById('closeGuestQr').focus();
}

async function closeGuestQr() {
  document.getElementById('guestQrBackdrop').hidden = true;
  await loadRooms();
  document.getElementById('roomStatusGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.getElementById('closeGuestQr')?.addEventListener('click', closeGuestQr);
document.getElementById('guestQrBackdrop')?.addEventListener('click', event => {
  if (event.target.id === 'guestQrBackdrop') closeGuestQr();
});

function renderQRCodes() {
  const input = document.getElementById('baseUrl');
  let base;
  try {
    const value = input.value.trim() || suggestedRoomQrUrl;
    base = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    if (base.pathname === '/') base.pathname = '/khach-hang.html';
  } catch (_) {
    showQrAddressMessage('Địa chỉ chưa hợp lệ. Hãy nhập IP LAN và cổng hoặc địa chỉ HTTPS của website.', 'danger');
    return;
  }

  roomQrBaseUrl = base.href;
  input.value = roomQrBaseUrl;
  showQrAddressMessage(qrNetworkNote(base) || `Mã QR sẽ mở trang dịch vụ tại ${base.origin}.`, isLocalQrHost(base.hostname) ? 'danger' : 'success');

  const container = document.getElementById('tablesContainer');
  if (!container) return;
  container.innerHTML = '';

  for (let i = 1; i <= 12; i++) {
    const roomNum = 100 + i;
    const room = roomsList.find(r => r.number === roomNum);
    const token = room?.stayToken || '';
    const pin = room?.pin || '';
    const orderUrl = getRoomServiceUrl(roomNum, token);
    const safeOrderUrl = escapeHtml(orderUrl);
    const qrImage = createHotelQrImage(orderUrl);

    const card = document.createElement('div');
    card.className = 'table-qr-card';
    card.innerHTML = `
      <div class="table-subtitle">GOLDEN HAVEN</div>
      <div class="table-title">PHÒNG ${roomNum}</div>
      ${pin ? `<div style="background:#fef3c7; color:#92400e; font-weight:800; font-size:12px; padding:3px 8px; border-radius:6px; margin-bottom:8px;">PIN: ${pin}</div>` : ''}
      <a href="${safeOrderUrl}" target="_blank" rel="noopener">
        <img class="qr-img" src="${qrImage}" alt="Mã QR dịch vụ Phòng ${roomNum}" loading="lazy">
      </a>
      <div class="instruction">Quét mã bằng camera để gọi dịch vụ phòng</div>
      <a class="qr-demo-link" href="${safeOrderUrl}" target="_blank" rel="noopener">Mở thử Phòng ${roomNum} →</a>
      <div class="qr-dest-url">${safeOrderUrl}</div>
    `;
    container.appendChild(card);
  }
}

function qrNetworkNote(url) {
  if (isLocalQrHost(url.hostname)) {
    return 'Điện thoại không mở được localhost. Chọn IP LAN của máy chủ, hoặc dùng địa chỉ HTTPS nếu web đã được triển khai.';
  }
  if (url.protocol === 'http:') return `Kết nối điện thoại cùng Wi-Fi với máy chủ và thử mở ${url.origin} trước khi quét.`;
  return '';
}

function showQrAddressMessage(message, type) {
  const alertBox = document.getElementById('ipAlertBox');
  if (!alertBox) return;
  alertBox.className = `alert-banner ${type}`;
  alertBox.style.display = 'block';
  alertBox.textContent = message;
}

function applyCustomUrl() {
  renderQRCodes();
}
window.applyCustomUrl = applyCustomUrl;

function useRoomQrAddress(address) {
  const input = document.getElementById('baseUrl');
  input.value = address;
  renderQRCodes();
}

function switchPort(port) {
  const url = new URL(roomQrBaseUrl);
  url.port = port;
  useRoomQrAddress(url.href);
}
window.switchPort = switchPort;

// ==========================================================================
// 5. Quản lý Đặt phòng trước (Reservations & Booking Scan)
// ==========================================================================
const bookingIdInput = document.getElementById('bookingIdInput');
const bookingScanStatus = document.getElementById('bookingScanStatus');
const bookingCamera = document.getElementById('bookingCamera');
const bookingConfirmBackdrop = document.getElementById('bookingConfirmBackdrop');
const bookingCheckinForm = document.getElementById('bookingCheckinForm');
let selectedBookingId = '';
let bookingCameraStream = null;
let bookingScannerTimer = null;

function parseBookingId(rawValue) {
  let value = String(rawValue || '').trim();
  try {
    const url = new URL(value);
    value = url.searchParams.get('booking') || '';
  } catch (_) {}
  return value.match(/\bBK-\d{4,}-[A-Z0-9]+\b/i)?.[0].toUpperCase() || '';
}

async function lookupBooking(rawValue = bookingIdInput?.value) {
  const bookingId = parseBookingId(rawValue);
  if (!bookingId) {
    if (bookingScanStatus) bookingScanStatus.textContent = 'Mã không hợp lệ. Hãy nhập mã BK-năm-số hoặc quét QR đặt phòng.';
    return;
  }
  if (bookingIdInput) bookingIdInput.value = bookingId;
  if (bookingScanStatus) bookingScanStatus.textContent = `Đang tra cứu ${bookingId}…`;
  try {
    const response = await fetch(`/api/reservations/${encodeURIComponent(bookingId)}`, { credentials: 'include', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không tìm thấy booking.');
    const reservation = data.reservation;
    if (!['pending', 'confirmed'].includes(String(reservation.status).toLowerCase())) {
      throw new Error(`Booking này đang ở trạng thái ${reservation.status}; không thể Check-in.`);
    }
    const roomsResponse = await fetch('/api/rooms', { credentials: 'include', cache: 'no-store' });
    const roomsData = await roomsResponse.json();
    if (!roomsResponse.ok) throw new Error(roomsData.error || 'Không tải được danh sách phòng.');
    const available = roomsData.rooms.filter(room => room.status === 'available' && (!reservation.roomType || room.type === reservation.roomType));
    if (!available.length) throw new Error('Chưa có phòng trống đúng loại khách đã đặt.');

    selectedBookingId = reservation.id;
    document.getElementById('bookingConfirmDetails').innerHTML = `
      <strong>${escapeHtml(reservation.guestName)} · ${escapeHtml(reservation.phone)}</strong>
      <span>${escapeHtml(reservation.email || 'Không có email')}</span>
      <span>${escapeHtml(reservation.roomTypeLabel || reservation.roomType || 'Chưa chọn loại phòng')} · ${reservation.guests || 1} khách</span>
      <span>Đặt lúc: ${HotelFolio.time(reservation.createdAt)}</span>
      <span>Dự kiến: ${HotelFolio.day(reservation.checkIn)} → ${HotelFolio.day(reservation.checkOut)} · ${escapeHtml(reservation.id)}</span>
      <span>Trạng thái: ${String(reservation.status).toUpperCase()}</span>
    `;
    document.getElementById('bookingRoomSelect').innerHTML = available.map(room => `<option value="${room.number}">Phòng ${room.number} · ${escapeHtml(room.typeLabel || 'Tiêu chuẩn')} · Trống</option>`).join('');
    bookingConfirmBackdrop.hidden = false;
    bookingScanStatus.textContent = 'Đã tìm thấy booking. Kiểm tra thông tin khách và xác nhận phòng.';
    document.getElementById('bookingRoomSelect').focus();
  } catch (error) {
    if (bookingScanStatus) bookingScanStatus.textContent = error.message;
  }
}

document.getElementById('lookupBookingButton')?.addEventListener('click', () => lookupBooking());
bookingIdInput?.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    lookupBooking();
  }
});
document.getElementById('cancelBookingCheckin')?.addEventListener('click', () => {
  bookingConfirmBackdrop.hidden = true;
  selectedBookingId = '';
});
bookingConfirmBackdrop?.addEventListener('click', event => {
  if (event.target === bookingConfirmBackdrop) {
    bookingConfirmBackdrop.hidden = true;
    selectedBookingId = '';
  }
});

bookingCheckinForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedBookingId) return;
  const button = bookingCheckinForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const roomNumber = bookingCheckinForm.elements.roomNumber.value;
    if (!roomNumber) throw new Error('Hãy chọn một phòng còn trống.');

    const response = await fetch(`/api/reservations/${encodeURIComponent(selectedBookingId)}/check-in`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomNumber })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thể hoàn tất Check-in.');
    bookingConfirmBackdrop.hidden = true;
    selectedBookingId = '';
    bookingCheckinForm.reset();
    bookingScanStatus.textContent = `Đã Check-in ${result.reservation.id} vào Phòng ${result.room.number}. PIN & QR dịch vụ phòng đã sẵn sàng!`;
    await loadReservations();
    await loadRooms();
    showRoomQr(result.room.number);
  } catch (error) {
    bookingScanStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function stopBookingCamera() {
  if (bookingScannerTimer) clearTimeout(bookingScannerTimer);
  bookingScannerTimer = null;
  if (bookingCameraStream) bookingCameraStream.getTracks().forEach(track => track.stop());
  bookingCameraStream = null;
  if (bookingCamera) {
    bookingCamera.srcObject = null;
    bookingCamera.hidden = true;
  }
  const scanBtn = document.getElementById('startBookingScan');
  if (scanBtn) scanBtn.textContent = 'Quét QR bằng camera';
}

document.getElementById('startBookingScan')?.addEventListener('click', async event => {
  if (bookingCameraStream) {
    stopBookingCamera();
    bookingScanStatus.textContent = 'Đã dừng camera. Bạn vẫn có thể nhập Booking ID thủ công.';
    return;
  }
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    bookingScanStatus.textContent = 'Trình duyệt chưa hỗ trợ quét QR camera. Hãy nhập Booking ID vào ô bên cạnh.';
    return;
  }
  const scanButton = event.currentTarget;
  try {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    bookingCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    bookingCamera.srcObject = bookingCameraStream;
    bookingCamera.hidden = false;
    await bookingCamera.play();
    scanButton.textContent = 'Dừng quét';
    bookingScanStatus.textContent = 'Hướng camera vào mã QR đặt phòng.';

    const scan = async () => {
      if (!bookingCameraStream) return;
      try {
        const codes = await detector.detect(bookingCamera);
        const bookingId = codes.map(code => parseBookingId(code.rawValue)).find(Boolean);
        if (bookingId) {
          stopBookingCamera();
          bookingIdInput.value = bookingId;
          await lookupBooking(bookingId);
          return;
        }
      } catch (_) {}
      bookingScannerTimer = setTimeout(scan, 350);
    };
    scan();
  } catch (_) {
    stopBookingCamera();
    bookingScanStatus.textContent = 'Không mở được camera. Hãy cấp quyền camera hoặc nhập Booking ID thủ công.';
  }
});

async function loadReservations() {
  const target = document.getElementById('reservationList');
  if (!target) return;
  try {
    const response = await fetch('/api/reservations', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Không tải được yêu cầu đặt phòng.');
    const data = await response.json();
    const statuses = {
      pending: 'Chờ xác nhận',
      confirmed: 'Đã xác nhận',
      checked_in: 'Khách đã nhận phòng',
      completed: 'Đã trả phòng',
      rejected: 'Đã từ chối',
      cancelled: 'Đã hủy'
    };
    target.innerHTML = data.reservations.length ? data.reservations.map(row => `
      <article class="reservation-row">
        <div>
          <strong>${escapeHtml(row.guestName)} · ${escapeHtml(row.phone)}</strong>
          <small>${escapeHtml(row.email || 'Chưa có email')} · ${escapeHtml(row.roomTypeLabel || row.roomType || 'Chưa chọn loại phòng')}</small>
          <small>Đặt lúc: ${HotelFolio.time(row.createdAt)} · ${escapeHtml(row.id)}</small>
          <small>Dự kiến: ${HotelFolio.day(row.checkIn)} → ${HotelFolio.day(row.checkOut)} · ${row.guests} khách</small>
          <small>Nhận thực tế: ${HotelFolio.time(row.checkedInAt)} · Trả thực tế: ${HotelFolio.time(row.checkedOutAt)}${row.roomNumber ? ` · Phòng ${row.roomNumber}` : ''}</small>
          <small>Trạng thái: <b>${statuses[String(row.status).toLowerCase()] || escapeHtml(row.status)}</b></small>
        </div>
        ${['pending', 'confirmed'].includes(String(row.status).toLowerCase()) ? `
          <div class="reservation-actions">
            ${String(row.status).toLowerCase() === 'pending' ? `
              <button data-reservation="${escapeHtml(row.id)}" data-status="confirmed">Xác nhận</button>
              <button data-reservation="${escapeHtml(row.id)}" data-status="rejected">Từ chối</button>` : ''}
            <button data-checkin-booking="${escapeHtml(row.id)}">Check-in</button>
          </div>` : row.receiptId ? `<div class="reservation-actions"><button type="button" data-receipt="${escapeHtml(row.receiptId)}">Xem hóa đơn</button></div>` : ''}
      </article>`).join('') : 'Chưa có yêu cầu đặt phòng mới.';
  } catch (error) {
    target.textContent = error.message;
  }
}

document.getElementById('reservationList')?.addEventListener('click', async event => {
  const receipt = event.target.closest('[data-receipt]');
  if (receipt) return openCheckoutFolio(null, receipt.dataset.receipt);
  const checkin = event.target.closest('[data-checkin-booking]');
  if (checkin) {
    document.getElementById('bookingIdInput').value = checkin.dataset.checkinBooking;
    await lookupBooking(checkin.dataset.checkinBooking);
    return;
  }
  const button = event.target.closest('[data-reservation]');
  if (!button) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/reservations/${encodeURIComponent(button.dataset.reservation)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: button.dataset.status })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thể cập nhật yêu cầu.');
    await loadReservations();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});

// Đăng xuất Lễ tân
document.getElementById('frontdeskLogout')?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  location.replace('/bo-phan.html');
});

// ==========================================================================
// 6. Khởi tạo toàn bộ trang
// ==========================================================================
window.addEventListener('DOMContentLoaded', async () => {
  const { url, addresses } = await getHotelQrAddress('/khach-hang.html');
  suggestedRoomQrUrl = url.href;
  useRoomQrAddress(suggestedRoomQrUrl);
  document.getElementById('btnLanIp').addEventListener('click', () => useRoomQrAddress(suggestedRoomQrUrl));
  const detected = document.getElementById('detectedIps');
  for (const address of addresses) {
    const alternative = new URL(url);
    alternative.hostname = address;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-ip-chip';
    button.textContent = address;
    button.addEventListener('click', () => useRoomQrAddress(alternative.href));
    detected.appendChild(button);
  }

  await loadReceptionOrders();
  await loadRooms();
  await loadReservations();

  setInterval(async () => {
    await loadReceptionOrders();
    await loadRooms();
    await loadReservations();
  }, 12000);

  const room = new URLSearchParams(location.search).get('room');
  if (room) showRoomQr(room);
});

