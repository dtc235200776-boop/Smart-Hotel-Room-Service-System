const form = document.getElementById('bookingForm');
const resultBox = document.getElementById('bookingResult');
const checkIn = document.getElementById('checkIn');
const checkOut = document.getElementById('checkOut');
const staffPortalReturn = document.getElementById('staffPortalReturn');
const bookingDateTime = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium' });
const bookingDay = value => String(value || '').split('-').reverse().join('/');
const bookingTime = value => value && Number.isFinite(Date.parse(value)) ? bookingDateTime.format(new Date(value)) : 'Chưa ghi nhận';
fetch('/api/session', { credentials: 'include', cache: 'no-store' })
  .then(response => response.ok ? response.json() : { staff: false })
  .then(session => { if (staffPortalReturn) staffPortalReturn.hidden = !session.staff; })
  .catch(() => { if (staffPortalReturn) staffPortalReturn.hidden = true; });
const localDate = offset => {
  return new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
};
checkIn.min = localDate(0);
checkOut.min = localDate(1);
checkIn.value = localDate(0);
checkOut.value = localDate(1);
const availabilityNote = document.getElementById('bookingAvailability');
const roomTypeSelect = form.elements.roomType;
const guestSelect = form.elements.guests;
const roomTypesGrid = document.getElementById('roomTypesGrid');
const bookingRoomSummary = document.getElementById('bookingRoomSummary');
let roomProfiles = [];
let availabilityRequest;

function setBookingRoom() {
  const profile = roomProfiles.find(room => room.type === roomTypeSelect.value);
  if (!profile) return;
  const guests = Math.min(Number(guestSelect.value) || 2, profile.maxGuests);
  guestSelect.replaceChildren(...Array.from({ length: profile.maxGuests }, (_, index) => new Option(`${index + 1} khách`, String(index + 1))));
  guestSelect.value = String(guests);
  bookingRoomSummary.hidden = false;
  bookingRoomSummary.textContent = `${profile.typeLabel} · ${profile.area} m² · tối đa ${profile.maxGuests} khách · ${RoomProfile.rate(profile.pricePerNight)}/đêm`;
  roomTypesGrid.querySelectorAll('[data-book-room]').forEach(button => {
    const current = button.dataset.bookRoom === profile.type;
    button.closest('article').classList.toggle('selected-room-type', current);
  });
}

async function loadRoomProfiles() {
  try {
    const response = await fetch('/api/room-types');
    if (!response.ok) throw new Error('Room catalog unavailable');
    roomProfiles = (await response.json()).types;
    roomTypesGrid.innerHTML = roomProfiles.map(profile => `
      <article class="room-showcase-card room-type-${RoomProfile.safe(profile.type)}">
        ${RoomProfile.photo(profile)}
        <div class="room-showcase-info">
          ${RoomProfile.details(profile)}
          <div class="room-showcase-actions">
            <span><strong>${RoomProfile.rate(profile.pricePerNight)}</strong> / đêm</span>
            <button class="button-wood" type="button" data-book-room="${RoomProfile.safe(profile.type)}">Chọn ${RoomProfile.safe(profile.typeLabel)}</button>
          </div>
        </div>
      </article>`).join('');
    const requestedType = new URLSearchParams(location.search).get('roomType');
    if (roomProfiles.some(room => room.type === requestedType)) roomTypeSelect.value = requestedType;
    setBookingRoom();
    updateAvailability();
  } catch (_) {
    roomTypesGrid.textContent = 'Chưa tải được thông tin hạng phòng. Bạn vẫn có thể chọn loại phòng ở biểu mẫu bên dưới.';
  }
}
roomTypesGrid.addEventListener('click', event => {
  const button = event.target.closest('[data-book-room]');
  if (!button) return;
  roomTypeSelect.value = button.dataset.bookRoom;
  setBookingRoom();
  updateAvailability();
  document.getElementById('booking').scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.elements.guestName.focus({ preventScroll: true });
});
loadRoomProfiles();
async function updateAvailability() {
  availabilityRequest?.abort();
  if (!checkIn.validity.valid || !checkOut.validity.valid || checkOut.value <= checkIn.value) {
    availabilityNote.textContent = '';
    return;
  }
  availabilityRequest = new AbortController();
  const params = new URLSearchParams({ roomType: form.elements.roomType.value, checkIn: checkIn.value, checkOut: checkOut.value });
  try {
    const res = await fetch(`/api/availability?${params}`, { signal: availabilityRequest.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    availabilityNote.textContent = data.available
      ? `Còn ${data.available} phòng đúng loại trong khoảng ngày đã chọn.`
      : 'Loại phòng này đã hết trong khoảng ngày đã chọn. Bạn có thể chọn loại phòng hoặc ngày khác.';
  } catch (error) {
    if (error.name !== 'AbortError') availabilityNote.textContent = 'Chưa kiểm tra được phòng trống. Có thể thử lại khi gửi yêu cầu.';
  }
}
checkIn.addEventListener('change', () => {
  const nextDay = new Date(`${checkIn.value}T00:00:00`); nextDay.setDate(nextDay.getDate() + 1);
  const minimum = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
  checkOut.min = minimum;
  if (checkOut.value < minimum) checkOut.value = minimum;
  updateAvailability();
});
checkOut.addEventListener('change', updateAvailability);
roomTypeSelect.addEventListener('change', () => {
  setBookingRoom();
  updateAvailability();
});
updateAvailability();
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; button.textContent = 'Đang gửi…'; resultBox.hidden = false; resultBox.textContent = 'Đang kiểm tra phòng và gửi yêu cầu tới tiếp tân…';
  const fields = new FormData(form);
  try {
    const response = await fetch('/api/reservations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(fields.entries()))
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Chưa gửi được yêu cầu. Vui lòng thử lại.');
    await showBookingResult(data.reservation, true);
    form.reset(); checkIn.value = localDate(0); checkOut.value = localDate(1); form.querySelector('[name="guests"]').value = '2';
    setBookingRoom();
  } catch (error) {
    resultBox.textContent = error.message;
  } finally {
    button.disabled = false; button.innerHTML = 'Gửi yêu cầu <span>→</span>';
    updateAvailability();
  }
});

const bookingId = new URLSearchParams(location.search).get('booking');
if (bookingId) {
  resultBox.hidden = false;
  resultBox.textContent = `Đang tra cứu đặt phòng ${bookingId}…`;
  fetch(`/api/reservations/${encodeURIComponent(bookingId)}`)
    .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Không tìm thấy đặt phòng.'); return data.reservation; })
    .then(async reservation => {
      await showBookingResult(reservation);
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    })
    .catch(error => { resultBox.textContent = error.message; });
}

async function showBookingResult(reservation, wasSubmitted = false) {
  const id = escapeBookingText(reservation.id);
  const status = escapeBookingText(reservation.statusLabel || 'Đang chờ xác nhận');
  const confirmation = wasSubmitted
    ? `<p>Lễ tân sẽ liên hệ qua số ${escapeBookingText(reservation.phone)} để xác nhận.</p>`
    : '';
  resultBox.innerHTML = `<div class="booking-success">
    <div>
      <strong>${wasSubmitted ? 'Đã nhận yêu cầu' : 'Mã đặt phòng'} ${id}</strong>
      <p>Trạng thái: <b>${status}</b></p>
      <p>${escapeBookingText(reservation.roomTypeLabel || reservation.roomType)} · Dự kiến ${escapeBookingText(bookingDay(reservation.checkIn))} – ${escapeBookingText(bookingDay(reservation.checkOut))}</p>
      <div class="booking-time-list">
        <p>Đặt lúc: ${bookingTime(reservation.createdAt)}</p>
        <p>Nhận thực tế: ${bookingTime(reservation.checkedInAt)}</p>
        <p>Trả thực tế: ${bookingTime(reservation.checkedOutAt)}</p>
      </div>
      ${confirmation}
      <p>Dùng mã này để xem trạng thái đặt phòng hoặc đưa lễ tân khi nhận phòng. QR để gọi dịch vụ sẽ được cấp sau khi nhận phòng.</p>
      <p id="bookingQrNetworkNote"></p>
      ${wasSubmitted ? '<p><a id="bookingStatusLink" hidden>Mở link tra cứu</a></p>' : ''}
    </div>
    <div class="booking-qr" hidden>
      <img alt="QR đặt phòng ${id}" width="192" height="192">
      <a class="button-wood" download="${id}.png">Tải QR đặt phòng</a>
    </div>
  </div>`;

  const { url } = await getHotelQrAddress('/home.html');
  url.searchParams.set('booking', reservation.id);
  const note = resultBox.querySelector('#bookingQrNetworkNote');
  if (isLocalQrHost(url.hostname)) {
    note.textContent = 'Chưa tìm thấy địa chỉ mở được từ điện thoại. Hãy mở lại trang bằng IP LAN hoặc địa chỉ website rồi lấy lại QR.';
  } else if (url.protocol === 'http:') {
    note.textContent = `Để quét bằng điện thoại, hãy kết nối cùng Wi-Fi với máy chủ và thử mở ${url.origin}.`;
  }

  const link = resultBox.querySelector('#bookingStatusLink');
  if (link) {
    link.href = url;
    link.hidden = false;
  }

  const qr = resultBox.querySelector('.booking-qr');
  try {
    const imageUrl = createHotelQrImage(url.href);
    qr.querySelector('img').src = imageUrl;
    qr.querySelector('a').href = imageUrl;
    qr.hidden = false;
  } catch (_) {
    const message = document.createElement('p');
    message.textContent = 'Chưa tạo được hình QR. Bạn vẫn có thể cung cấp mã đặt phòng ở trên cho lễ tân.';
    note.after(message);
  }
}

function escapeBookingText(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
