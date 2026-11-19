const normalize = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const { hotelDay } = require('./hotel-folio');
const money = amount => amount ? `${amount.toLocaleString('vi-VN')} đ` : 'Miễn phí';
const words = text => new Set(normalize(text).split(' ').filter(word => word.length >= 2));
const stopWords = new Set('toi muon ban minh anh chi cho xin hoi co gia nao bao nhieu vai voi trong cac duoc khong the nhu thi ve tai phong dich vu'.split(' '));
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

async function chatWithHotel(question, history, menu, roomTypes, checkAvailability) {
  const previous = Array.isArray(history) ? history.filter(q => typeof q === 'string').slice(-4).map(q => q.slice(0, 300)) : [];
  const original = normalize(question);
  // The model may label an intent, but dates, quantities and room names only come from the guest.
  const context = (previous.at(-1) || '').split(' · ')[0];
  const intent = await classifyQuestion(question, previous);
  const explicitTopic = /\b(thanh toan|hoa don|tra phong|nhan phong|don phong|quet qr|ma pin|wifi|den san bay)\b/.test(original);
  const explicitRoom = roomTypes.some(room => original.includes(normalize(room.typeLabel).replace('phong ', '')));
  const explicitMenu = menu.some(item => {
    const title = [...words(item.name)].filter(word => !stopWords.has(word));
    const query = words(original);
    return title.filter(word => query.has(word)).length >= 2;
  });
  const isFollowUp = Boolean(context) && followUp.test(original) && !explicitTopic && !explicitRoom && !explicitMenu;
  const lookup = isFollowUp ? `${question} · ${context}` : question;
  let answer = answerHotelQuestion(lookup, menu, roomTypes, checkAvailability);
  const hotelCue = /\b(khach san|phong|luu tru|ky nghi|le tan|dich vu|an uong|mon|hoa don|nhan|tra|thue|dem|gia|dat)\b/;
  if (answer.unknown && intentQueries[intent] && hotelCue.test(normalize(lookup))) {
    answer = answerHotelQuestion(`${lookup} ${intentQueries[intent]}`, menu, roomTypes, checkAvailability);
  }
  const remembered = isFollowUp ? `${context} · ${question}` : question;
  return { text: answer.text, action: answer.action, context: remembered, mode: intent ? 'model' : 'lookup' };
}

const topics = [
  [/ma bk|ma dat|tra cuu|tinh trang dat/, 'Bạn có thể mở QR đặt phòng hoặc đưa mã BK cho lễ tân để tra cứu. Yêu cầu mới ở trạng thái chờ xác nhận. Nếu đã mở trang tra cứu, tải lại trang để xem trạng thái mới nhất.', 'booking'],
  [/nhan phong|check in|checkin|tra phong|check out|checkout/, 'Khi đến, đưa mã BK cho lễ tân để xác nhận và nhận phòng. Khi trả phòng, mang thẻ phòng đến lễ tân để đối chiếu tiền phòng và dịch vụ. Lễ tân xác nhận giờ cụ thể theo đặt phòng của bạn.', 'booking'],
  [/hoa don|thanh toan|tra tien|tien mat|chuyen khoan|vietqr/, 'Bạn có thể thanh toán dịch vụ tại quầy hoặc gộp cùng tiền phòng khi trả phòng. Sau khi xác nhận đã thu tiền, thu ngân hoặc lễ tân có thể in hóa đơn lưu trú hoặc lưu thành PDF. Hãy dùng thông tin thanh toán do nhân viên cung cấp.', ''],
  [/quet|ma qr|goi dich vu|gui yeu cau|theo doi|ma pin/, 'Sau khi nhận phòng, quét QR dịch vụ do lễ tân cấp. Chọn món hoặc tiện ích, bấm Xem yêu cầu rồi gửi. Bạn có thể theo dõi trạng thái trên cùng trang. Nếu được hỏi PIN, dùng mã PIN lễ tân đã cung cấp.', 'services'],
  [/dat phong|con phong|phong trong|doi ngay|huy dat/, 'Vào Đặt phòng trên trang chủ, chọn loại phòng, nhập ngày nhận và ngày trả cùng thông tin liên hệ. Lễ tân sẽ xác nhận tình trạng phòng. Nếu cần đổi ngày hoặc hủy yêu cầu đã gửi, liên hệ lễ tân kèm mã BK.', 'booking'],
  [/lien he|le tan|khieu nai|khan cap|tro giup|mat do|wifi|wi fi|internet/, 'Bạn có thể gọi số máy nhánh 0 từ điện thoại trong phòng. Nếu đã có QR dịch vụ, bạn cũng có thể chọn Yêu cầu hỗ trợ tại phòng. Lễ tân cung cấp thông tin Wi-Fi hoặc tiếp nhận việc cần hỗ trợ.', 'housekeeping']
];

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

function answerHotelQuestion(question, menu, roomTypes, checkAvailability) {
  const normalized = normalize(question);
  if (!normalized) return { text: 'Bạn có thể hỏi về giá phòng, thực đơn, dọn phòng, nhận phòng hoặc thanh toán.' };
  const chosen = roomTypes.find(room => normalized.includes(normalize(room.typeLabel).replace('phong ', '')));
  const dates = readDates(question);
  if (checkAvailability && dates.length === 2 && /\b(con phong|phong trong|dat phong|con .* khong|co phong|con .+ ngay)\b/.test(normalized)) {
    const count = checkAvailability(dates[0], dates[1], chosen?.type);
    if (count === null) return { text: 'Bạn hãy kiểm tra lại ngày nhận và ngày trả phòng. Ngày nhận phải từ hôm nay trở đi và trước ngày trả.', action: 'booking' };
    const label = chosen ? chosen.typeLabel : 'phòng thuộc mọi loại';
    return { text: `Lịch từ ${dates[0]} đến ${dates[1]} hiện còn ${count} ${label}. Bạn có thể gửi yêu cầu để lễ tân xác nhận.`, action: 'booking' };
  }
  if (/^(chao|hello|hi|xin chao)( ban)?$/.test(normalized)) return { text: 'Xin chào! Mình có thể giúp xem giá phòng, tìm món trong thực đơn hoặc hướng dẫn bạn nhận và trả phòng.' };
  if (/\b(cam on|thanks)\b/.test(normalized) && normalized.split(' ').length <= 7) return { text: 'Rất vui được hỗ trợ bạn. Bạn cứ hỏi tiếp nếu cần thêm thông tin nhé.' };
  if (/di ung|an chay|khong gluten/.test(normalized)) return { text: 'Bạn có thể ghi chú nhu cầu ăn uống trong yêu cầu dịch vụ. Nếu có dị ứng, hãy báo lễ tân qua máy nhánh 0 để bếp xác nhận nguyên liệu trước khi đặt.', action: 'dining' };
  if (/gia phong|loai phong|gia .* dem|tien phong|phong .* bao nhieu/.test(normalized) ||
      (chosen && /\b(gia|bao nhieu|may tien|dem)\b/.test(normalized))) {
    const rates = (chosen ? [chosen] : roomTypes).map(room => `${room.typeLabel}: ${money(room.pricePerNight)}/đêm`);
    const numberWords = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7 };
    const count = normalized.match(/\b(\d{1,2}|mot|hai|ba|bon|nam|sau|bay) dem\b/)?.[1];
    const nights = Number(numberWords[count] || count);
    const estimate = chosen && nights > 0 ? `\nTạm tính ${nights} đêm: ${money(nights * chosen.pricePerNight)}. Chi phí dịch vụ tính riêng.` : '';
    return { text: `${rates.join('\n')}${estimate}\nTình trạng phòng được lễ tân xác nhận theo ngày bạn chọn.`, action: 'booking' };
  }
  if (chosen && /\b(con|trong|dat|co khong)\b/.test(normalized)) return {
    text: `Bạn muốn nhận và trả ${chosen.typeLabel} ngày nào? Ví dụ, nhập 2026-12-01 đến 2026-12-03 để mình kiểm tra lịch phòng.`, action: 'booking'
  };
  const topic = topics.find(([pattern]) => pattern.test(normalized));
  if (topic) return { text: topic[1], action: topic[2] };

  const intentWords = [...words(normalized)].filter(word => !stopWords.has(word));
  const matches = menu.map(item => {
    const titleWords = words(item.name);
    const meaningful = intentWords.filter(word => titleWords.has(word));
    return { item, score: meaningful.length };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score);
  if (matches.length) {
    const highest = matches[0];
    const selected = matches.filter(row => row.score === highest.score).slice(0, 4);
    return {
      text: selected.map(({ item }) => {
        const price = Math.round(item.price * (100 - (item.salePercent || 0)) / 100);
        const availability = item.available === false ? ' · Tạm hết' : '';
        return `${item.name} — ${money(price)}${availability}. ${item.desc || ''}`;
      }).join('\n\n'),
      action: highest.item.section === 'dining' ? 'dining' : 'housekeeping'
    };
  }
  if (/an uong|thuc don|do an|do uong|am thuc|minibar/.test(normalized)) return {
    text: 'Thực đơn có điểm tâm, món chính, trái cây, cà phê, trà và đồ uống minibar. Bạn có thể hỏi tên món cụ thể để xem giá.',
    action: 'dining'
  };
  if (/buong phong|tien ich|ve sinh|do dung/.test(normalized)) return {
    text: 'Buồng phòng hỗ trợ dọn phòng, bổ sung khăn hoặc nước, cho mượn đồ và giặt ủi. Bạn có thể hỏi tên dịch vụ để xem giá.',
    action: 'housekeeping'
  };
  return { unknown: true, text: 'Mình chưa có thông tin về câu hỏi này. Bạn có thể hỏi về đặt phòng, giá món, dọn phòng hoặc thanh toán. Với các yêu cầu riêng, hãy hỏi lễ tân qua máy nhánh 0.' };
}

module.exports = { chatWithHotel };
