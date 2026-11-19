(() => {
  const widget = document.createElement('aside');
  widget.className = 'hotel-chat';
  widget.setAttribute('aria-label', 'Trợ lý khách sạn');
  widget.innerHTML = `
    <section class="hotel-chat-panel" id="hotelChatPanel" aria-labelledby="hotelChatTitle" hidden>
      <header>
        <div><strong id="hotelChatTitle">Trợ lý GOLDEN HAVEN</strong><small>Đặt phòng, dịch vụ và lưu trú</small></div>
        <button class="hotel-chat-close" type="button" aria-label="Đóng trợ lý">×</button>
      </header>
      <div class="hotel-chat-log" role="log" aria-live="polite" aria-relevant="additions">
        <p class="hotel-chat-answer">Xin chào! Bạn muốn hỏi về phòng, thực đơn hay dịch vụ tại phòng?</p>
      </div>
      <div class="hotel-chat-suggestions" aria-label="Câu hỏi gợi ý">
        <button type="button">Giá phòng bao nhiêu?</button>
        <button type="button">Gọi dịch vụ bằng QR thế nào?</button>
        <button type="button">Thanh toán ở đâu?</button>
      </div>
      <form class="hotel-chat-form">
        <input type="text" name="question" aria-label="Câu hỏi của bạn" placeholder="Nhập câu hỏi…" maxlength="300" autocomplete="off" required>
        <button type="submit">Gửi</button>
      </form>
      <p class="hotel-chat-status" role="status"></p>
    </section>
    <button class="hotel-chat-toggle" type="button" aria-controls="hotelChatPanel" aria-expanded="false">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 11a8 8 0 0 1-8 8H9l-5 2 1.6-4.8A8 8 0 1 1 20 11Z"/><path d="M8 11h8M8 14h5"/></svg>
      Trợ lý khách sạn
    </button>
  `;
  document.body.append(widget);

  const panel = widget.querySelector('.hotel-chat-panel');
  const toggle = widget.querySelector('.hotel-chat-toggle');
  const close = widget.querySelector('.hotel-chat-close');
  const form = widget.querySelector('form');
  const input = form.elements.question;
  const log = widget.querySelector('.hotel-chat-log');
  const status = widget.querySelector('.hotel-chat-status');
  const suggestions = widget.querySelector('.hotel-chat-suggestions');
  const actions = {
    booking: ['/home.html#booking', 'Đến trang đặt phòng'],
    rooms: ['/home.html#roomTypes', 'Xem các hạng phòng'],
    services: ['/khach-hang.html', 'Xem dịch vụ tại phòng'],
    dining: ['/khach-hang.html#drinkSection', 'Xem thực đơn'],
    housekeeping: ['/khach-hang.html#foodSection', 'Xem tiện ích']
  };
  let sending = false;
  let recentQuestions = [];
  let conversation = null;

  function setPanel(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    (open ? input : toggle).focus();
  }
  function appendMessage(text, fromGuest, action, roomType) {
    const message = document.createElement('p');
    message.className = fromGuest ? 'hotel-chat-question' : 'hotel-chat-answer';
    message.textContent = text;
    if (actions[action]) {
      const [path, label] = actions[action];
      const link = document.createElement('a');
      const target = new URL(path, location.origin);
      if (target.pathname === location.pathname && target.pathname === '/khach-hang.html') target.search = location.search;
      if (target.pathname === '/home.html' && ['/', '/home.html'].includes(location.pathname)) {
        target.pathname = location.pathname;
        target.search = location.search;
        if (action === 'booking' && roomType) link.addEventListener('click', () => {
          const select = document.getElementById('bookingForm')?.elements.roomType;
          if (select) {
            select.value = roomType;
            select.dispatchEvent(new Event('change'));
          }
        });
      } else if (action === 'booking' && roomType) {
        target.searchParams.set('roomType', roomType);
      }
      link.href = target.href;
      link.textContent = label;
      message.append(link);
    }
    log.append(message);
    log.scrollTop = log.scrollHeight;
  }

  function showSuggestions(questions) {
    suggestions.replaceChildren(...questions.slice(0, 3).map(question => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = question;
      return button;
    }));
  }
  async function ask(text) {
    const question = text.trim();
    if (!question || sending) return;
    sending = true;
    input.value = '';
    form.querySelector('button').disabled = true;
    appendMessage(question, true);
    status.textContent = 'Đang tìm thông tin…';
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: recentQuestions, conversation }), signal: AbortSignal.timeout(11000)
      });
      if (!response.ok) throw new Error('Không kết nối được trợ lý.');
      const answer = await response.json();
      recentQuestions = [...recentQuestions, question].slice(-4);
      conversation = answer.conversation || null;
      appendMessage(answer.text, false, answer.action, conversation?.roomType);
      if (Array.isArray(answer.suggestions)) showSuggestions(answer.suggestions);
    } catch (_) {
      appendMessage('Trợ lý tạm thời chưa phản hồi. Bạn có thể hỏi lễ tân qua máy nhánh 0 hoặc thử gửi lại.', false);
    } finally {
      status.textContent = '';
      form.querySelector('button').disabled = false;
      sending = false;
    }
  }

  toggle.addEventListener('click', () => setPanel(panel.hidden));
  close.addEventListener('click', () => setPanel(false));
  widget.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setPanel(false);
  });
  suggestions.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button) ask(button.textContent);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    ask(input.value);
  });
})();
