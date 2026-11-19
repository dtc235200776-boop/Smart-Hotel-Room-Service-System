const folioList = document.getElementById('cashierFolioList');
const folioNotice = document.getElementById('cashierFolioNotice');
const folioTabs = document.querySelectorAll('[data-folio-view]');
const folioSearch = document.getElementById('cashierFolioSearch');
let folioData = { active: [], receipts: [] };
let folioView = 'active';
let folioLoading = false;
let folioRefreshPending = false;

function showFolioView(view) {
  folioView = view;
  folioTabs.forEach(tab => {
    const selected = tab.dataset.folioView === view;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-pressed', String(selected));
  });
  renderCashierFolios();
}

function renderCashierFolios() {
  const opened = new Set([...folioList.querySelectorAll('details[open]')].map(card => card.dataset.id));
  const chosenMethods = new Map([...folioList.querySelectorAll('select')].map(input => [input.closest('details').dataset.id, input.value]));
  const { safe, time, money, options, detail } = HotelFolio;
  const search = folioSearch.value.trim().toLocaleLowerCase('vi');
  const entries = folioData[folioView].filter(row =>
    `Phòng ${row.room.number} ${row.room.guestName} ${row.room.reservationId || ''} ${row.id || ''}`.toLocaleLowerCase('vi').includes(search)
  );
  folioList.innerHTML = entries.map(row => {
    const key = row.id || row.stayId;
    const status = row.id ? 'Đã thanh toán' : row.canCheckOut ? 'Chờ thu tiền' : 'Chờ hoàn tất dịch vụ';
    return `<details class="bill-card folio-card" data-id="${safe(key)}" ${opened.has(key) ? 'open' : ''}>
      <summary><div><strong>Phòng ${row.room.number} · ${safe(row.room.guestName)}</strong>
        <small>${row.id ? `${safe(row.id)} · ${time(row.paidAt)}` : `${row.orders.length} yêu cầu dịch vụ`}</small>
      </div><span>${status} · ${money(row.id ? row.amountReceived : row.amountDue)}</span></summary>
      <div class="folio-card-body">
        ${detail(row)}
        <div class="folio-actions">
          <button class="receipt-button" data-print-folio type="button">${row.id ? 'In hóa đơn / Lưu PDF' : 'In phiếu tạm tính'}</button>
          ${row.id ? '' : `<label>Phương thức <select>${options()}</select></label>
            <button class="pay-button" data-settle-room type="button" ${row.canCheckOut ? '' : 'disabled'}>Xác nhận đã thu tiền</button>`}
        </div>
      </div>
    </details>`;
  }).join('') || `<p class="admin-empty">${search ? 'Không có phiếu khớp với nội dung tìm.' : folioView === 'active' ? 'Chưa có phòng đang lưu trú. Phiếu hiện ở đây ngay khi lễ tân nhận khách.' : 'Chưa có hóa đơn lưu trú đã thanh toán.'}</p>`;
  folioList.querySelectorAll('select').forEach(input => {
    const value = chosenMethods.get(input.closest('details').dataset.id);
    if (value) input.value = value;
  });
}

async function loadCashierFolios() {
  if (folioLoading) {
    folioRefreshPending = true;
    return;
  }
  folioLoading = true;
  try {
    folioData = await api('/api/folios');
    renderCashierFolios();
  } catch (error) {
    folioNotice.textContent = error.message;
  } finally {
    folioLoading = false;
    if (folioRefreshPending) {
      folioRefreshPending = false;
      loadCashierFolios();
    }
  }
}

folioTabs.forEach(tab => tab.addEventListener('click', () => showFolioView(tab.dataset.folioView)));
folioSearch.addEventListener('input', renderCashierFolios);
folioList.addEventListener('click', async event => {
  const button = event.target.closest('[data-print-folio], [data-settle-room]');
  if (!button) return;
  const card = button.closest('details');
  const folio = folioData[folioView].find(row => (row.id || row.stayId) === card.dataset.id);
  if (!folio) return;
  if (button.hasAttribute('data-print-folio')) return HotelFolio.print(folio);
  if (!confirm(`Xác nhận đã nhận ${HotelFolio.money(folio.amountDue)} từ phòng ${folio.room.number}?`)) return;
  button.disabled = true;
  try {
    const { receipt } = await api(`/api/rooms/${folio.room.number}/bill`, {
      method: 'POST',
      body: JSON.stringify({
        stayId: folio.stayId, expectedAmount: folio.amountDue, paymentMethod: card.querySelector('select').value
      })
    });
    folioData.receipts = [receipt, ...folioData.receipts.filter(row => row.id !== receipt.id)];
    folioSearch.value = '';
    showFolioView('receipts');
    [...folioList.querySelectorAll('details')].find(card => card.dataset.id === receipt.id)?.setAttribute('open', '');
    folioNotice.textContent = `Đã lưu hóa đơn ${receipt.id}. Bấm In hóa đơn / Lưu PDF để giao khách.`;
  } catch (error) {
    folioNotice.textContent = error.message;
  } finally {
    loadCashierFolios();
  }
});

loadCashierFolios();
window.addEventListener('hotel-billing-updated', loadCashierFolios);
