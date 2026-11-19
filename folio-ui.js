const HotelFolio = (() => {
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const money = amount => `${Number(amount || 0).toLocaleString('vi-VN')} đ`;
  const dateTime = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium'
  });
  const time = value => value && Number.isFinite(Date.parse(value)) ? dateTime.format(new Date(value)) : 'Chưa ghi nhận';
  const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : '—';
  const methods = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', other: 'Khác' };
  const options = () => Object.entries(methods).map(([key, label]) => `<option value="${key}">${label}</option>`).join('');

  function detail(folio) {
    const { room, orders } = folio;
    const items = orders.map(order => `
      <li>
        <div class="folio-line"><strong>${safe(order.id)}</strong><span>${money(order.amountPaid ?? order.totalPrice)}</span></div>
        <small>${time(order.createdAt)} · ${order.status === 'paid' ? 'Đã thu' : ['ready', 'served'].includes(order.status) ? 'Đã phục vụ' : 'Chưa hoàn tất'}</small>
        ${order.items.map(item => `<div class="folio-line"><span>${item.qty} × ${safe(item.name)}</span><span>${money(item.total)}</span></div>`).join('')}
        ${order.voucherDiscount ? `<small>Ưu đãi ${safe(order.voucherCode)}: −${money(order.voucherDiscount)}</small>` : ''}
      </li>`).join('');
    return `
      <div class="folio-guest"><strong>${safe(room.guestName)}</strong> · ${safe(room.typeLabel)}
        ${room.reservationId ? `<span> · ${safe(room.reservationId)}</span>` : ''}
      </div>
      <dl class="folio-timeline">
        ${room.reservationId ? `<div><dt>Đặt phòng</dt><dd>${time(room.bookedAt)}</dd></div>` : ''}
        <div><dt>Nhận phòng thực tế</dt><dd>${room.checkedInAt ? time(room.checkedInAt) : day(room.checkIn) + ' · chưa ghi giờ'}</dd></div>
        <div><dt>Dự kiến trả phòng</dt><dd>${day(room.plannedCheckout)}</dd></div>
        <div><dt>Trả phòng thực tế</dt><dd>${time(folio.checkedOutAt)}</dd></div>
        ${folio.id ? `<div><dt>Thu tiền</dt><dd>${time(folio.paidAt)} · ${safe(methods[folio.paymentMethod])}</dd></div>` : ''}
      </dl>
      <div class="folio-line"><span>Tiền phòng · ${room.nights} đêm × ${money(room.pricePerNight)}</span><strong>${money(room.roomTotal)}</strong></div>
      <ul class="folio-items">${items || '<li>Chưa có dịch vụ phát sinh.</li>'}</ul>
      <div class="folio-line"><span>Tiền dịch vụ</span><strong>${money(folio.servicesTotal)}</strong></div>
      <div class="folio-line"><span>Tổng tiền phòng và dịch vụ</span><strong>${money(folio.grandTotal)}</strong></div>
      ${folio.servicesPaid ? `<div class="folio-line"><span>Dịch vụ đã thu trước</span><span>${money(folio.servicesPaid)}</span></div>` : ''}
      <div class="folio-line folio-total"><span>${folio.id ? 'Đã thu khi quyết toán' : 'Cần thu'}</span><strong>${money(folio.id ? folio.amountReceived : folio.amountDue)}</strong></div>
    `;
  }

  function print(folio) {
    const target = document.getElementById('receiptPrint');
    target.innerHTML = `
      <h2>GOLDEN HAVEN &amp; Resort</h2>
      <p><strong>${folio.id ? 'HÓA ĐƠN LƯU TRÚ · ĐÃ THANH TOÁN' : 'PHIẾU TẠM TÍNH'}</strong></p>
      <p>Phòng ${folio.room.number}${folio.id ? ` · ${safe(folio.id)}` : ''}</p>
      <p>Giờ Việt Nam (UTC+7)</p><hr>
      ${detail(folio)}
      <hr><p>Cảm ơn quý khách đã lưu trú!</p>`;
    document.body.classList.add('printing-folio');
    try { window.print(); }
    finally { document.body.classList.remove('printing-folio'); }
  }

  return { safe, money, time, day, options, detail, print };
})();
