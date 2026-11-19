const normalize = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(ko|khongg|hong|kh)\b/g, 'khong').replace(/\s+/g, ' ').trim();
const { hotelDay } = require('./hotel-folio');
const money = amount => amount ? `${amount.toLocaleString('vi-VN')} đ` : 'Miễn phí';
const followUp = /^(con |vay |the |loai do|mon do|cai do|no |bao nhieu|may tien|gia sao|gia the nao|tu ngay|tu \d|ngay mai)|\b(bao nhieu mot dem|o \d+ dem)\b/;

let activeModelRequests = 0;
const intentQueries = {
  RATE: 'giá phòng', RESERVE: 'đặt phòng', QR: 'gọi dịch vụ bằng QR',
  ARRIVAL: 'nhận phòng', DEPARTURE: 'trả phòng', PAY: 'thanh toán',
  FOOD: 'thực đơn', ROOM_SERVICE: 'buồng phòng', CONTACT: 'liên hệ lễ tân'
};
const modelIntents = [...Object.keys(intentQueries), 'OTHER'];

async function classifyQuestion(question, history) {
  const endpoint = process.env.HOTEL_AI_ENDPOINT || (process.env.RENDER ? '' : 'http://127.0.0.1:8189/v1/chat/completions');
  if (!endpoint || activeModelRequests >= 2) return '';
  activeModelRequests++;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.HOTEL_AI_KEY) headers.Authorization = `Bearer ${process.env.HOTEL_AI_KEY}`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers, signal: AbortSignal.timeout(8500),
      body: JSON.stringify({
        model: process.env.HOTEL_AI_MODEL || 'golden-haven-qwen',
        temperature: 0, max_tokens: 16,
        ...(!process.env.HOTEL_AI_ENDPOINT ? { grammar: 'root ::= ' + modelIntents.map(intent => JSON.stringify(intent)).join(' | ') } : {}),
        messages: [{
          role: 'system',
          content: 'Classify the latest Vietnamese hotel question. Reply with one code only. RATE=room price; RESERVE=book or check vacancy; QR=room QR or PIN; ARRIVAL=check in; DEPARTURE=check out; PAY=bill or payment; FOOD=menu; ROOM_SERVICE=housekeeping; CONTACT=contact reception; OTHER=anything else. Use recent questions only when the latest is a follow-up.'
        }, {
          role: 'user', content: `Recent guest questions: ${JSON.stringify(history)}\nLatest guest question: ${JSON.stringify(question)}\nCode:`
        }]
      })
    });
    if (!response.ok) return '';
    const output = (await response.json()).choices?.[0]?.message?.content?.trim().toUpperCase();
    const code = output?.match(/^(?:CODE:\s*)?([A-Z_]+)\b/)?.[1];
    return modelIntents.includes(code) ? code : '';
  } catch (_) {
    return '';
  } finally {
    activeModelRequests--;
  }
}

const roomAliases = {
  standard: ['tieu chuan', 'standard', 'phong thuong'],
  deluxe: ['deluxe'],
  suite: ['suite']
};
const serviceAliases = {
  1: ['don phong', 'doi ga', 'thay ga', 've sinh phong'],
  2: ['khan tam', 'bo ve sinh', 'them khan'],
  3: ['ban ui', 'cau la'],
  4: ['may say toc', 'o cam', 'adapter'],
  5: ['giat ui', 'giat say', 'giat quan ao'],
  6: ['giat hap', 'giat vest'],
  7: ['thue xe may', 'xe tay ga'],
  8: ['dua don san bay', 'xe san bay'],
  9: ['an sang', 'continental', 'diem tam'],
  10: ['pho', 'pho bo'],
  11: ['bit tet', 'steak'],
  12: ['mi y', 'spaghetti'],
  13: ['sandwich'],
  14: ['trai cay', 'hoa qua'],
  15: ['ca phe', 'robusta', 'cafe'],
  16: ['tra lai', 'tra mat ong', 'tra chanh'],
  17: ['ruou vang', 'vang do'],
  18: ['nuoc ngot', 'coca', '7up'],
  19: ['bia', 'heineken'],
  20: ['nuoc khoang', 'nuoc minibar'],
  21: ['them nuoc', 'bo sung nuoc', 'nuoc uong'],
  22: ['ho tro tai phong', 'goi nhan vien']
};
const hotelCue = /\b(khach san|phong|luu tru|ky nghi|le tan|dich vu|an uong|mon|hoa don|giat|do dung|dem|dat|giao tan noi)\b/;
const presence = /^(xin chao|chao|hello|hi|alo|bot oi|tro ly oi|co ai khong|co o day khong)( ban| a| nhe| nhi)?$|\b(tro ly|ban) (co )?((o )?day|dang nghe|online)( khong)?( a| nhi| vay)?$/;
const continuation = /^(gioi thieu (tiep|them)|ke them|noi tiep|tiep theo|tiep tuc|con gi nua|cho minh biet them)( di| nua| voi| nhe| a| nha)*$/;
const isPrice = /\b(gia|bao nhieu tien|may tien|tien phong|het bao nhieu|bao nhieu mot dem)\b/;
const isAvailable = /\b(con phong|phong trong|co phong|kha dung|con .* khong|kiem tra lich)\b/;
const introSteps = ['rooms', 'services', 'booking', 'payment'];
const genericSuggestions = ['So sánh 3 hạng phòng', 'Cho mình xem thực đơn', 'Đặt phòng thế nào?'];

const guides = {
  booking: { text: 'Chọn hạng phòng, ngày nhận và ngày trả. Điền số khách và thông tin liên hệ rồi bấm Gửi yêu cầu. Bạn sẽ nhận mã BK và QR để tra cứu. Lễ tân sẽ xác nhận yêu cầu.', action: 'booking', suggestions: ['Còn phòng Deluxe không?', 'Nhận phòng thế nào?'] },
  lookup: { text: 'Mở liên kết trong QR đặt phòng để xem trạng thái, hoặc đưa mã BK cho lễ tân. Lễ tân có thể dùng mã này để tìm và xác nhận yêu cầu.', action: 'booking', suggestions: ['Nhận phòng thế nào?', 'Dùng QR trong phòng thế nào?'] },
  arrival: { text: 'Khi đến, đưa mã BK hoặc QR đặt phòng cho lễ tân. Lễ tân chọn phòng trống đúng hạng và cấp QR dịch vụ cùng PIN. Nếu cần giờ nhận phòng cụ thể, hãy kiểm tra với lễ tân.', action: 'booking', suggestions: ['Dùng QR trong phòng thế nào?', 'Trả phòng thế nào?'] },
  services: { text: 'Sau khi nhận phòng, quét QR dịch vụ để chọn món ăn hoặc tiện ích như dọn phòng, thêm khăn và giặt ủi. Bấm Xem yêu cầu rồi gửi. Bạn có thể theo dõi trạng thái phục vụ ngay trên trang.', action: 'services', suggestions: ['Cho mình xem thực đơn', 'Giặt ủi bao nhiêu?', 'Thanh toán ở đâu?'] },
  food: { text: 'Bạn có thể chọn điểm tâm, món chính, trái cây hoặc đồ uống ngay tại phòng. Hỏi tên một món để xem giá và tình trạng phục vụ.', action: 'dining', suggestions: ['Phở bò bao nhiêu tiền?', 'Cà phê giá bao nhiêu?'] },
  housekeeping: { text: 'Buồng phòng nhận yêu cầu dọn phòng, thêm khăn hoặc nước, mượn đồ và giặt ủi. Quét QR phòng để chọn dịch vụ cần dùng.', action: 'housekeeping', suggestions: ['Thêm khăn tắm có mất phí?', 'Giặt ủi bao nhiêu?'] },
  payment: { text: 'Khi trả phòng, lễ tân hoặc thu ngân đối chiếu tiền phòng, dịch vụ và khoản đã thu trước. Sau khi nhận tiền, nhân viên in hóa đơn hoặc lưu PDF. Nếu thanh toán dịch vụ trước, khoản đó sẽ được ghi vào phiếu phòng.', action: '', suggestions: ['Trả phòng thế nào?', 'Cách liên hệ lễ tân'] },
  checkout: { text: 'Mang thẻ phòng đến quầy lễ tân. Nhân viên kiểm tra các dịch vụ đã dùng, xác nhận đã thanh toán, giao hóa đơn và hoàn tất trả phòng. Bạn có thể hỏi lễ tân về giờ trả phòng của lượt lưu trú.', action: '', suggestions: ['Thanh toán ở đâu?', 'Cách liên hệ lễ tân'] },
  contact: { text: 'Trong phòng, gọi số máy nhánh 0 hoặc chọn Yêu cầu hỗ trợ tại phòng trên QR dịch vụ. Lễ tân sẽ kiểm tra các yêu cầu riêng, thông tin Wi-Fi và chính sách lưu trú.', action: 'housekeeping', suggestions: ['Dùng QR trong phòng thế nào?'] },
  allergy: { text: 'Vui lòng báo lễ tân qua máy nhánh 0 và ghi chú cho bếp. Nhân viên cần xác nhận nguyên liệu cụ thể trước khi bạn đặt món.', action: 'dining', suggestions: ['Cho mình xem thực đơn', 'Cách liên hệ lễ tân'] }
};

function findRoomTypes(text, roomTypes) {
  const token = ` ${text} `;
  return roomTypes.filter(room => (roomAliases[room.type] || []).some(alias => token.includes(` ${alias} `)));
}

function findService(text, menu) {
  const token = ` ${text} `;
  const aliases = menu.flatMap(item => (serviceAliases[item.id] || []).map(alias => ({ item, alias })))
    .sort((left, right) => right.alias.length - left.alias.length);
  return aliases.find(({ alias }) => token.includes(` ${alias} `))?.item;
}

function readDates(text) {
  const today = hotelDay();
  const year = Number(today.slice(0, 4));
  const dates = [];
  for (const match of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b|\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) {
    if (match[1]) dates.push(match[1]);
    else {
      const day = match[2].padStart(2, '0');
      const month = match[3].padStart(2, '0');
      const proposed = `${match[4] || year}-${month}-${day}`;
      dates.push(!match[4] && proposed < today ? `${year + 1}-${month}-${day}` : proposed);
    }
  }
  return [...new Set(dates)].slice(0, 2);
}

function roomFacts(room) {
  return `${room.typeLabel} · ${room.area} m² · tối đa ${room.maxGuests} khách\n${room.bed}. ${room.amenities.join(' · ')}. ${money(room.pricePerNight)}/đêm.`;
}

function guideReply(topic, state) {
  return { ...guides[topic], state: { topic, tourStep: state.tourStep } };
}

function explainRoom(room) {
  return {
    text: roomFacts(room), action: 'rooms', state: { topic: 'room', roomType: room.type, tourStep: 0 },
    suggestions: ['Phòng đó còn trống không?', 'Vậy 2 đêm bao nhiêu?', 'Giới thiệu tiếp đi']
  };
}

function overview(roomTypes) {
  return { text: roomTypes.map(roomFacts).join('\n\n'), action: 'rooms', state: { topic: 'rooms', tourStep: 0 },
    suggestions: ['Deluxe có gì?', 'Suite ở được mấy người?', 'Giới thiệu tiếp đi'] };
}

function answerQuestion(question, menu, roomTypes, checkAvailability, state) {
  const text = normalize(question);
  if (presence.test(text)) return { text: 'Mình đây! Bạn muốn mình giới thiệu các hạng phòng, dịch vụ tại phòng hay cách đặt phòng?', suggestions: genericSuggestions, state };
  if (/^(cam on|thanks)( ban| nhe| nha| a)?$/.test(text)) return { text: 'Rất vui được hỗ trợ bạn. Bạn cứ hỏi tiếp nếu cần thêm thông tin nhé.', suggestions: genericSuggestions, state };
  if (continuation.test(text)) {
    const next = introSteps[(state.tourStep + 1) % introSteps.length];
    const answer = next === 'rooms' ? overview(roomTypes) : guideReply(next, state);
    answer.state.tourStep = introSteps.indexOf(next);
    if (next !== 'payment') answer.suggestions = [...answer.suggestions.slice(0, 2).filter(q => q !== 'Giới thiệu tiếp đi'), 'Giới thiệu tiếp đi'];
    return answer;
  }
  if (/^gioi thieu( ve)?( khach san| golden haven)?( di| nhe)?$|\b(so sanh|khac nhau|cac hang phong|cac loai phong|co nhung phong nao)\b/.test(text)) {
    const requested = findRoomTypes(text, roomTypes);
    return overview(requested.length > 1 ? requested : roomTypes);
  }

  const requested = findRoomTypes(text, roomTypes);
  const refersBack = followUp.test(text) || /\b(phong do|loai do|mon do|dich vu do|co gi|may nguoi)\b/.test(text);
  const dates = readDates(question);
  const room = requested[0] || ((refersBack || dates.length) && roomTypes.find(profile => profile.type === state.roomType));
  const namedItem = findService(text, menu);
  const availability = !namedItem && ((isAvailable.test(text) && (room || /\bphong\b/.test(text))) || (dates.length > 0 && state.topic === 'availability'));
  if (availability) {
    const conversation = { topic: 'availability', roomType: room?.type, tourStep: 0 };
    if (dates.length < 2) return {
      text: `Bạn muốn nhận và trả ${room?.typeLabel.toLowerCase() || 'phòng'} ngày nào? Hãy nhập cả hai ngày, ví dụ 01/12/2026 đến 03/12/2026.`,
      action: 'booking', state: conversation
    };
    const count = checkAvailability(dates[0], dates[1], room?.type);
    const label = room?.typeLabel.toLowerCase() || 'phòng thuộc mọi hạng';
    return {
      text: count === null ? 'Ngày nhận phải từ hôm nay trở đi và trước ngày trả. Bạn gửi lại hai ngày giúp mình nhé.'
        : count ? `Từ ${dates[0].split('-').reverse().join('/')} đến ${dates[1].split('-').reverse().join('/')}, lịch hiện còn ${count} ${label}. Bạn có thể gửi yêu cầu để lễ tân xác nhận.`
          : `Hạng bạn chọn hiện đã hết trong khoảng ngày này. Bạn có thể xem hạng khác hoặc đổi ngày.`,
      action: count === 0 ? 'rooms' : 'booking', state: conversation
    };
  }
  if (/\b(di ung|an chay|khong gluten)\b/.test(text)) return guideReply('allergy', state);
  if (/\b(ma bk|ma dat|tra cuu|tinh trang dat|qr dat phong)\b/.test(text)) return guideReply('lookup', state);
  if (/\b(hoa don|thanh toan|tra tien|tien mat|chuyen khoan|vietqr)\b/.test(text)) return guideReply('payment', state);
  if (/\b(quet qr|ma qr|goi dich vu|qr trong phong|gui yeu cau|ma pin)\b/.test(text)) return guideReply('services', state);
  if (/\b(tra phong|check out|checkout)\b/.test(text)) return guideReply('checkout', state);
  if (/\b(nhan phong|check in|checkin)\b/.test(text)) return guideReply('arrival', state);
  if (/\b(dat phong|doi ngay|huy dat)\b/.test(text)) return guideReply('booking', state);
  if (/\b(lien he|le tan|khieu nai|khan cap|mat do|wifi|wi fi|internet)\b/.test(text)) return guideReply('contact', state);

  const item = namedItem || (refersBack && state.topic === 'item' && menu.find(row => row.id === state.serviceId));
  if (item) {
    const price = Math.round(item.price * (100 - (item.salePercent || 0)) / 100);
    return {
      text: `${item.name} · ${money(price)}${item.available === false ? ' · hiện tạm hết' : ''}. ${item.desc || ''}`,
      action: item.section === 'dining' ? 'dining' : 'housekeeping',
      state: { topic: 'item', serviceId: item.id, tourStep: 1 },
      suggestions: ['Dùng QR trong phòng thế nào?', 'Thanh toán ở đâu?']
    };
  }

  const numberWords = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7 };
  const count = (unit) => {
    const value = text.match(new RegExp(`\\b(\\d{1,2}|mot|hai|ba|bon|nam|sau|bay) ${unit}\\b`))?.[1];
    return Number(numberWords[value] || value);
  };
  const nights = count('dem');
  if (requested.length > 1) return overview(requested);
  if (room && (nights > 0 || isPrice.test(text))) {
    return {
      text: `${room.typeLabel} giá ${money(room.pricePerNight)}/đêm.${nights > 0 ? ` Tạm tính ${nights} đêm: ${money(nights * room.pricePerNight)}. Dịch vụ gọi thêm tính riêng.` : ''}`,
      action: 'booking', state: { topic: 'rates', roomType: room.type, tourStep: 0 },
      suggestions: ['Vậy 2 đêm bao nhiêu?', 'Phòng đó có gì?', 'Phòng đó còn trống không?']
    };
  }
  const guests = count('(?:nguoi|khach)');
  if (!room && guests > 0) {
    const fits = roomTypes.filter(profile => profile.maxGuests >= guests);
    return fits.length ? { ...overview(fits), text: `Với ${guests} người, bạn có thể chọn:\n\n${fits.map(roomFacts).join('\n\n')}` }
      : { text: 'Hạng Suite nhận tối đa 4 khách. Với nhóm đông hơn, bạn có thể chọn nhiều phòng và liên hệ lễ tân để sắp xếp phòng gần nhau.', action: 'rooms', state: { topic: 'rooms', tourStep: 0 } };
  }
  if (room) return explainRoom(room);
  if (/\b(gia phong|hang phong|loai phong|tien phong)\b/.test(text)) return overview(roomTypes);
  if (/\b(an uong|thuc don|do an|do uong|am thuc|minibar)\b/.test(text)) return guideReply('food', state);
  if (/\b(buong phong|tien ich|ve sinh|do dung)\b/.test(text)) return guideReply('housekeeping', state);
  return null;
}

async function chatWithHotel(question, history, menu, roomTypes, checkAvailability, conversation) {
  const previous = Array.isArray(history) ? history.filter(q => typeof q === 'string').slice(-4).map(q => q.slice(0, 300)) : [];
  const roomFromHistory = findRoomTypes(normalize(previous.at(-1) || ''), roomTypes)[0];
  const state = {
    topic: ['room', 'rooms', 'rates', 'availability', 'item'].includes(conversation?.topic) ? conversation.topic : '',
    roomType: roomTypes.find(room => room.type === conversation?.roomType)?.type || roomFromHistory?.type,
    serviceId: menu.find(item => item.id === conversation?.serviceId)?.id,
    tourStep: Number.isInteger(conversation?.tourStep) && conversation.tourStep >= 0 && conversation.tourStep < introSteps.length ? conversation.tourStep : -1
  };
  let mode = 'lookup';
  let answer = answerQuestion(question, menu, roomTypes, checkAvailability, state);
  if (!answer && hotelCue.test(normalize(question))) {
    const intent = await classifyQuestion(question, previous);
    if (intentQueries[intent]) {
      answer = answerQuestion(`${question} ${intentQueries[intent]}`, menu, roomTypes, checkAvailability, state);
      if (answer) mode = 'model';
    }
  }
  answer ||= { text: 'Mình chưa hiểu ý bạn. Bạn muốn hỏi về phòng, đặt phòng hay một dịch vụ cụ thể? Hãy cho mình tên hạng phòng hoặc món để mình tra đúng giá.', suggestions: genericSuggestions, state };
  return { text: answer.text, action: answer.action, suggestions: answer.suggestions || genericSuggestions,
    conversation: answer.state, context: question, mode };
}

module.exports = { chatWithHotel };
