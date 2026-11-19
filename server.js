const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { hotelDay, makeFolio, ordersForStay, paymentMethods, settleFolio } = require('./hotel-folio');
const { chatWithHotel } = require('./hotel-assistant');

const ROOT = __dirname;
const BUILD_VERSION = '2026-11-19-golden-haven-1';
const DATA_FILE = path.join(ROOT, 'data.json');
let PORT = Number(process.env.PORT || 3000);
const ON_RENDER = process.env.RENDER === 'true';
const PUBLIC_DEPLOYMENT = ON_RENDER || process.env.NODE_ENV === 'production';
const DEMO_PASSWORD = '123456';
const STAFF_ACCOUNTS = {
  receptionist: { username: 'letan', passwordKey: 'HOTEL_STAFF_RECEPTIONIST_PASSWORD' },
  cashier: { username: 'thungan', passwordKey: 'HOTEL_STAFF_CASHIER_PASSWORD' },
  housekeeping: { username: 'buongphong', passwordKey: 'HOTEL_STAFF_HOUSEKEEPING_PASSWORD' },
  kitchen: { username: 'bep', passwordKey: 'HOTEL_STAFF_KITCHEN_PASSWORD' },
  manager: { username: 'quanly', passwordKey: 'HOTEL_STAFF_MANAGER_PASSWORD' }
};
const hashPassword = password => crypto.createHash('sha256').update(password).digest();
const staffPasswords = new Map(Object.entries(STAFF_ACCOUNTS).map(([role, account]) => [
  role, process.env[account.passwordKey]?.trim() || (PUBLIC_DEPLOYMENT ? '' : DEMO_PASSWORD)
]));
const publicLoginConfigured = [...staffPasswords.values()].every(password => password.length >= 12)
  && new Set(staffPasswords.values()).size === staffPasswords.size;
const staffPasswordHashes = new Map([...staffPasswords].map(([role, password]) => [role, hashPassword(password)]));
const LEGACY_PORT = Number(process.env.LEGACY_PORT || 5500);
const seedInventory = [
  { id: 'towels', name: 'Khăn tắm', category: 'Buồng phòng', quantity: 38, minimum: 12, unit: 'chiếc' },
  { id: 'linen', name: 'Bộ ga gối', category: 'Buồng phòng', quantity: 18, minimum: 6, unit: 'bộ' },
  { id: 'amenities', name: 'Bộ đồ dùng cá nhân', category: 'Buồng phòng', quantity: 26, minimum: 10, unit: 'bộ' },
  { id: 'detergent', name: 'Nước giặt', category: 'Buồng phòng', quantity: 9, minimum: 4, unit: 'can' },
  { id: 'pho', name: 'Bánh phở & nước dùng', category: 'Bếp', quantity: 16, minimum: 6, unit: 'phần' },
  { id: 'beef', name: 'Thịt bò', category: 'Bếp', quantity: 7, minimum: 5, unit: 'kg' },
  { id: 'coffee', name: 'Cà phê & trà', category: 'Bếp', quantity: 14, minimum: 5, unit: 'hộp' },
  { id: 'water', name: 'Nước khoáng', category: 'Minibar', quantity: 32, minimum: 12, unit: 'chai' },
  { id: 'soft-drink', name: 'Nước ngọt', category: 'Minibar', quantity: 10, minimum: 12, unit: 'lon' },
  { id: 'beer', name: 'Bia', category: 'Minibar', quantity: 22, minimum: 8, unit: 'lon' }
];
const SESSION_COOKIE = 'hotel_pos_staff';
const sessionCookie = (token, maxAge) => `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${PUBLIC_DEPLOYMENT ? '; Secure' : ''}`;
const sessions = new Map();
const streams = new Set();
const pinFailures = new Map();

// Hồ sơ hạng phòng dùng chung cho đặt phòng, lễ tân và trợ lý.
const ROOM_CONFIGS = {
  standard: {
    type: 'standard', typeLabel: 'Phòng tiêu chuẩn', pricePerNight: 450000, maxGuests: 2, area: 22,
    image: '/assets/rooms/standard.jpg', bed: '1 giường đôi',
    description: 'Phòng gọn cho chuyến công tác ngắn hoặc kỳ nghỉ hai người.',
    amenities: ['Bàn làm việc nhỏ', 'Phòng tắm vòi sen']
  },
  deluxe: {
    type: 'deluxe', typeLabel: 'Phòng Deluxe', pricePerNight: 750000, maxGuests: 3, area: 32,
    image: '/assets/rooms/deluxe.jpg', bed: '1 giường queen, có thể kê thêm giường',
    description: 'Thêm chỗ ngồi và không gian thư giãn cho kỳ nghỉ dài hơn.',
    amenities: ['Ghế thư giãn cạnh cửa sổ', 'Góc làm việc rộng']
  },
  suite: {
    type: 'suite', typeLabel: 'Phòng Suite', pricePerNight: 1200000, maxGuests: 4, area: 48,
    image: '/assets/rooms/suite.jpg', bed: '1 giường king và 1 sofa giường',
    description: 'Không gian tiếp khách riêng, phù hợp cho gia đình hoặc nhóm nhỏ.',
    amenities: ['Phòng khách riêng', 'Bàn ăn trong phòng']
  }
};

function getRoomDefaults(roomNumber) {
  if (roomNumber <= 104) return ROOM_CONFIGS.standard;
  if (roomNumber <= 108) return ROOM_CONFIGS.deluxe;
  return ROOM_CONFIGS.suite;
}

// Công thức định mức trừ tồn kho tự động theo từng món dịch vụ
const INVENTORY_RECIPES = {
  1: [{ id: 'detergent', qty: 1 }, { id: 'linen', qty: 1 }],       // Dọn phòng & Đổi ga gối
  2: [{ id: 'towels', qty: 2 }, { id: 'amenities', qty: 1 }],        // Bổ sung khăn tắm & Bộ vệ sinh
  10: [{ id: 'pho', qty: 1 }, { id: 'beef', qty: 1 }],              // Phở bò
  15: [{ id: 'coffee', qty: 1 }],                                   // Cà phê
  18: [{ id: 'soft-drink', qty: 1 }],                               // Nước ngọt lon minibar
  19: [{ id: 'beer', qty: 1 }],                                     // Bia lon minibar
  20: [{ id: 'water', qty: 1 }],                                    // Nước khoáng minibar
  21: [{ id: 'water', qty: 2 }]                                     // Bổ sung nước uống
};

const seedServices = [
  // 1. Dịch vụ buồng phòng & Tiện ích (Housekeeping & Amenities)
  { id: 1, section: 'housekeeping', category: 'cleaning', name: 'Yêu cầu dọn phòng & Đổi ga gối', price: 0, desc: 'Nhân viên buồng phòng sẽ đến hút bụi, dọn phòng và thay ga gối mới', icon: '🧹', salePercent: 0 },
  { id: 2, section: 'housekeeping', category: 'cleaning', name: 'Bổ sung khăn tắm & Bộ vệ sinh', price: 0, desc: 'Bổ sung 2 khăn tắm lớn, bàn chải, dầu gội và sữa tắm', icon: '🛁', salePercent: 0 },
  { id: 3, section: 'housekeeping', category: 'amenities', name: 'Mượn bàn ủi & Cầu là', price: 0, desc: 'Mượn bàn ủi hơi nước và cầu là sử dụng tại phòng (miễn phí 2h)', icon: '👔', salePercent: 0 },
  { id: 4, section: 'housekeeping', category: 'amenities', name: 'Mượn máy sấy tóc & Ổ cắm quốc tế', price: 0, desc: 'Máy sấy tóc ion âm và củ sạc đa năng chuyển đổi chuẩn cắm', icon: '🔌', salePercent: 0 },
  { id: 5, section: 'housekeeping', category: 'laundry', name: 'Giặt sấy quần áo tiêu chuẩn (Bộ)', price: 45000, desc: 'Nhận giặt sạch, sấy khô và gấp gọn giao lại trong 4 tiếng', icon: '🧺', salePercent: 10 },
  { id: 6, section: 'housekeeping', category: 'laundry', name: 'Giặt hấp ủi cao cấp (Vest / Đầm)', price: 85000, desc: 'Giặt hấp chuyên dụng giữ phom dáng đồ cao cấp', icon: '👗', salePercent: 0 },
  { id: 7, section: 'housekeeping', category: 'rental', name: 'Thuê xe máy tay ga (Theo ngày)', price: 150000, desc: 'Xe tay ga đời mới, kèm 2 mũ bảo hiểm và giao xe tại sảnh', icon: '🛵', salePercent: 0 },
  { id: 8, section: 'housekeeping', category: 'rental', name: 'Xe đưa đón sân bay 4-7 chỗ', price: 320000, desc: 'Xe riêng đưa đón tận sảnh khách sạn đúng giờ hẹn', icon: '🚗', salePercent: 0 },
  { id: 21, section: 'housekeeping', category: 'amenities', name: 'Bổ sung nước uống trong phòng', price: 0, desc: 'Nhân viên buồng phòng giao thêm nước uống đóng chai đến phòng', icon: '💧', salePercent: 0 },
  { id: 22, section: 'housekeeping', category: 'amenities', name: 'Yêu cầu hỗ trợ tại phòng', price: 0, desc: 'Gọi nhân viên hỗ trợ và phối hợp lễ tân khi cần thiết', icon: '🛎️', salePercent: 0 },

  // 2. Ẩm thực & Minibar tại phòng (In-Room Dining)
  { id: 9, section: 'dining', category: 'breakfast', name: 'Set Ăn sáng kiểu Âu (Continental)', price: 65000, desc: 'Bánh sừng bò, trứng ốp la, xúc xích Đức, bơ mứt và nước cam', icon: '🍳', salePercent: 10 },
  { id: 10, section: 'dining', category: 'breakfast', name: 'Phở bò tái nạm tại phòng', price: 59000, desc: 'Bát phở bò nóng hổi kèm quẩy giòn và rau thơm phục vụ tận phòng', icon: '🍲', salePercent: 0 },
  { id: 11, section: 'dining', category: 'main', name: 'Bò bít tết sốt tiêu đen khoai tây', price: 129000, desc: 'Thịt thăn bò mềm mọng, sốt tiêu thơm lừng và khoai tây múi cau', icon: '🥩', salePercent: 0 },
  { id: 12, section: 'dining', category: 'main', name: 'Mì Ý sốt bò bằm Spaghetti', price: 79000, desc: 'Mì Ý truyền thống sốt thịt bò bằm cà chua phô mai Parmesan', icon: '🍝', salePercent: 0 },
  { id: 13, section: 'dining', category: 'main', name: 'Club Sandwich gà nướng phô mai', price: 55000, desc: 'Bánh kẹp 3 tầng thịt gà nướng, xà lách, cà chua và sốt mayo', icon: '🥪', salePercent: 0 },
  { id: 14, section: 'dining', category: 'snack', name: 'Đĩa trái cây tươi nhiệt đới', price: 49000, desc: 'Dưa hấu, thanh long, xoài cát và nho tươi mát lạnh', icon: '🍉', salePercent: 0 },
  { id: 15, section: 'dining', category: 'beverage', name: 'Cà phê Robusta Đắk Lắk pha phin', price: 30000, desc: 'Cà phê nguyên chất đậm đà, dùng kèm sữa đặc hoặc đá', icon: '☕', salePercent: 0 },
  { id: 16, section: 'dining', category: 'beverage', name: 'Trà lài mật ong chanh vàng', price: 35000, desc: 'Trà hoa lài ủ lạnh thanh mát cùng mật ong rừng và chanh vàng', icon: '🫖', salePercent: 0 },
  { id: 17, section: 'dining', category: 'beverage', name: 'Rượu vang đỏ Chile (Ly)', price: 85000, desc: 'Vang đỏ Cabernet Sauvignon hảo hạng phục vụ cùng ly pha lê', icon: '🍷', salePercent: 0 },
  { id: 18, section: 'dining', category: 'minibar', name: 'Nước ngọt lon Minibar (Coca/7Up)', price: 20000, desc: 'Lon 330ml ướp lạnh sẵn sàng', icon: '🥤', salePercent: 0 },
  { id: 19, section: 'dining', category: 'minibar', name: 'Bia Heineken lon Minibar', price: 35000, desc: 'Bia Heineken Silver 330ml ướp lạnh', icon: '🍺', salePercent: 0 },
  { id: 20, section: 'dining', category: 'minibar', name: 'Nước khoáng thiên nhiên cao cấp', price: 15000, desc: 'Chai nước khoáng tinh khiết đóng chai 500ml', icon: '💧', salePercent: 0 }
];

// Khởi tạo hoặc cập nhật data.json sang dữ liệu khách sạn
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ menu: seedServices, orders: [] }, null, 2));

const readStore = () => {
  const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  let legacyRoomUpdated = false;
  if (!Array.isArray(store.menu)) store.menu = seedServices.map(item => ({ ...item }));
  else {
    let menuChanged = false;
    for (const item of seedServices) if (!store.menu.some(existing => existing.id === item.id)) { store.menu.push({ ...item }); menuChanged = true; }
    if (menuChanged) writeStore(store);
  }
  if (!Array.isArray(store.orders)) store.orders = [];
  if (!Array.isArray(store.reservations)) store.reservations = [];
  if (!Array.isArray(store.receipts)) store.receipts = [];
  if (!Array.isArray(store.rooms)) {
    store.rooms = Array.from({ length: 12 }, (_, index) => {
      const num = 101 + index;
      const def = getRoomDefaults(num);
      return {
        number: num,
        type: def.type,
        typeLabel: def.typeLabel,
        pricePerNight: def.pricePerNight,
        status: 'available',
        guestName: '',
        guestPhone: '',
        checkIn: '',
        plannedCheckout: '',
        stayToken: '',
        pin: ''
      };
    });
  } else {
    for (const room of store.rooms) {
      const def = getRoomDefaults(room.number);
      if (!room.type) room.type = def.type;
      if (!room.typeLabel) room.typeLabel = def.typeLabel;
      if (!room.pricePerNight) room.pricePerNight = def.pricePerNight;
      if (room.status === 'occupied') {
        room.stayId ||= `legacy-${room.number}-${room.checkedInAt || room.checkIn}`;
        if (!room.stayToken || !room.pin) {
          room.stayToken ||= crypto.randomBytes(16).toString('hex').toUpperCase();
          room.pin ||= String(crypto.randomInt(1000, 10000));
          legacyRoomUpdated = true;
        }
        for (const order of ordersForStay(store, room)) {
          if (!order.stayId) {
            order.stayId = room.stayId;
            legacyRoomUpdated = true;
          }
        }
      } else {
        if (room.stayToken) room.stayToken = '';
        if (room.pin) room.pin = '';
      }
    }
  }
  if (!Array.isArray(store.inventory)) store.inventory = seedInventory.map(item => ({ ...item }));
  if (legacyRoomUpdated) writeStore(store);
  return store;
};

const writeStore = store => {
  const temporary = DATA_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2));
  fs.renameSync(temporary, DATA_FILE);
};

const sendJson = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const getCookie = (req, name) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
const getRole = req => { const token = getCookie(req, SESSION_COOKIE); const session = sessions.get(token); if (session && session.expires > Date.now()) return session.role; if (token) sessions.delete(token); return null; };
const isStaff = req => Boolean(getRole(req));
const canAccess = (role, allowed) => role === 'manager' || allowed.includes(role);
const readBody = req => new Promise((resolve, reject) => { let data = ''; req.on('data', chunk => { data += chunk; if (data.length > 1_000_000) reject(new Error('Dữ liệu gửi lên quá lớn')); }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('JSON không hợp lệ')); } }); req.on('error', reject); });

function broadcast(order) {
  for (const client of streams) {
    const role = client.staffRequest && getRole(client.staffRequest);
    const view = role ? orderForRole(order, role) : client.stayId && client.stayId === order.stayId ? order : null;
    if (view && !client.res.destroyed) {
      client.res.write(`event: order\ndata: ${JSON.stringify(view)}\n\n`);
    }
  }
}

function orderForRole(order, role) {
  const station = { kitchen: 'dining', housekeeping: 'housekeeping' }[role];
  if (!station) return order;
  if (!order.stations?.[station]) return null;
  const { id, table, createdAt, updatedAt, status } = order;
  return { id, table, createdAt, updatedAt, status, stations: { [station]: order.stations[station] },
    items: order.items.filter(item => item.section === station) };
}

function roomAccessMatches(room, token, pin = '') {
  return room?.status === 'occupied' &&
    Boolean((token && room.stayToken && String(token).toUpperCase() === room.stayToken.toUpperCase()) ||
      (pin && room.pin && String(pin) === room.pin));
}

function stockRequirements(items) {
  const required = new Map();
  for (const item of items) {
    for (const ingredient of INVENTORY_RECIPES[item.id] || []) {
      required.set(ingredient.id, (required.get(ingredient.id) || 0) + ingredient.qty * item.qty);
    }
  }
  return [...required].map(([id, qty]) => ({ id, qty }));
}

function publicMenu(store) {
  const inventory = new Map(store.inventory.map(item => [item.id, item.quantity]));
  return store.menu.map(item => ({
    ...item,
    available: item.available !== false && (INVENTORY_RECIPES[item.id] || []).every(ingredient => (inventory.get(ingredient.id) || 0) >= ingredient.qty)
  }));
}

function updateOrder(store, order) { const index = store.orders.findIndex(row => row.id === order.id); if (index >= 0) store.orders[index] = order; writeStore(store); broadcast(order); }

function broadcastFolio() {
  for (const client of streams) {
    if (client.staffRequest && getRole(client.staffRequest) && !client.res.destroyed) client.res.write('event: folio\ndata: {}\n\n');
  }
}

function beginStay(room, guestName, guestPhone, plannedCheckout, reservation, now, guests = reservation?.guests || 1) {
  const checkedInAt = now.toISOString();
  Object.assign(room, {
    status: 'occupied', guestName, guestPhone, guests, checkIn: hotelDay(now), plannedCheckout,
    checkedInAt, updatedAt: checkedInAt, stayId: crypto.randomUUID(), receiptId: '',
    reservationId: reservation?.id || '', stayToken: crypto.randomBytes(16).toString('hex').toUpperCase(),
    pin: String(crypto.randomInt(1000, 10000))
  });
  if (reservation) {
    Object.assign(reservation, { status: 'CHECKED_IN', roomNumber: room.number, checkedInAt, updatedAt: checkedInAt });
    reservation.serviceUrl = `/khach-hang.html?room=${room.number}&token=${room.stayToken}`;
  }
}
function availableRooms(store, checkIn, checkOut, roomType, excludedBooking) {
  if (!roomType) return Object.keys(ROOM_CONFIGS).reduce((total, type) => total + availableRooms(store, checkIn, checkOut, type), 0);
  const rooms = store.rooms.filter(room => room.type === roomType);
  const today = hotelDay();
  const tomorrow = hotelDay(new Date(Date.now() + 86400000));
  const events = new Map([[checkIn, 0]]);
  const hold = (from, to) => {
    if (!from || !to || from >= to || from >= checkOut || to <= checkIn) return;
    const start = from < checkIn ? checkIn : from;
    const end = to > checkOut ? checkOut : to;
    events.set(start, (events.get(start) || 0) + 1);
    events.set(end, (events.get(end) || 0) - 1);
  };
  for (const room of rooms) {
    if (room.status === 'maintenance') hold(checkIn, checkOut);
    if (room.status === 'cleaning') hold(today, tomorrow);
    if (room.status === 'occupied') hold(room.checkIn || today, room.plannedCheckout > today ? room.plannedCheckout : tomorrow);
  }
  for (const reservation of store.reservations) {
    if (reservation.id !== excludedBooking && reservation.roomType === roomType &&
        ['pending', 'confirmed'].includes(String(reservation.status).toLowerCase())) {
      hold(reservation.checkIn, reservation.checkOut);
    }
  }
  let held = 0;
  let peak = 0;
  for (const date of [...events.keys()].sort()) {
    held += events.get(date);
    peak = Math.max(peak, held);
  }
  return Math.max(0, rooms.length - peak);
}
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health') res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'hotel-room-service', app: 'GOLDEN HAVEN', version: BUILD_VERSION, port: PORT, time: new Date().toISOString() });
    if (req.method === 'GET' && url.pathname === '/api/network') {
      if (ON_RENDER && process.env.RENDER_EXTERNAL_URL) {
        const serviceUrl = new URL('/khach-hang.html', process.env.RENDER_EXTERNAL_URL);
        return sendJson(res, 200, { address: serviceUrl.hostname, addresses: [], url: serviceUrl.href });
      }
      const interfaces = Object.entries(os.networkInterfaces());
      const virtualAdapter = /virtual|vmware|vbox|vethernet|hyper-v|wsl|docker|loopback|vpn|tailscale|zerotier|tunnel/i;
      const lanAddresses = [...new Set(interfaces
        .sort(([first], [second]) => Number(virtualAdapter.test(first)) - Number(virtualAdapter.test(second)))
        .flatMap(([, entries]) => entries || [])
        .filter(item => item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'))
        .map(item => item.address))];
      const hostHeader = req.headers.host || 'localhost';
      const parsedHost = new URL(`http://${hostHeader}`);
      const host = parsedHost.hostname;
      const localHost = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(host);
      const address = localHost ? (lanAddresses[0] || 'localhost') : host;
      const protocol = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
      const publicAddress = !localHost && parsedHost.port !== String(LEGACY_PORT) ? hostHeader : `${address}:${PORT}`;
      return sendJson(res, 200, { address, addresses: lanAddresses, url: `${protocol}://${publicAddress}/khach-hang.html` });
    }
    if (req.method === 'GET' && url.pathname === '/api/session') { const role = getRole(req); return sendJson(res, 200, { staff: Boolean(role), role }); }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      if (PUBLIC_DEPLOYMENT && !publicLoginConfigured) return sendJson(res, 503, { error: 'Đăng nhập nội bộ đang chờ cấu hình mật khẩu trên máy chủ.' });
      const body = await readBody(req);
      const role = String(body.role || '');
      const account = STAFF_ACCOUNTS[role];
      const passwordHash = staffPasswordHashes.get(role);
      if (!passwordHash || String(body.username || '').trim() !== account.username ||
          !crypto.timingSafeEqual(hashPassword(String(body.password || '').trim()), passwordHash)) {
        return sendJson(res, 401, { error: 'Tài khoản, mật khẩu hoặc bộ phận không chính xác.' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { expires: Date.now() + 12 * 60 * 60 * 1000, role });
      res.setHeader('Set-Cookie', sessionCookie(token, 43200));
      return sendJson(res, 200, { ok: true, role });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      sessions.delete(getCookie(req, SESSION_COOKIE));
      res.writeHead(204, { 'Set-Cookie': sessionCookie('', 0), 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/menu') return sendJson(res, 200, { items: publicMenu(readStore()) });
    if (req.method === 'GET' && url.pathname === '/api/room-types') return sendJson(res, 200, { types: Object.values(ROOM_CONFIGS) });
    if (req.method === 'GET' && url.pathname === '/api/payment-info') {
      const bankId = String(process.env.HOTEL_BANK_ID || '').trim();
      const account = String(process.env.HOTEL_BANK_ACCOUNT || '').trim();
      const accountName = String(process.env.HOTEL_BANK_NAME || '').trim();
      const bank = /^[A-Z0-9]{2,16}$/i.test(bankId) && /^\d{6,25}$/.test(account) && accountName
        ? { bankId, account, accountName } : null;
      return sendJson(res, 200, { bank });
    }
    if (req.method === 'POST' && url.pathname === '/api/assistant') {
      const { question, history, conversation } = await readBody(req);
      if (typeof question !== 'string' || !question.trim() || question.length > 300) return sendJson(res, 400, { error: 'Nhập câu hỏi từ 1 đến 300 ký tự.' });
      const store = readStore();
      const menu = publicMenu(store);
      const checkDates = (from, to, type) => validDate(from) && validDate(to) && from >= hotelDay() && from < to
        ? availableRooms(readStore(), from, to, type) : null;
      return sendJson(res, 200, await chatWithHotel(question, history, menu, Object.values(ROOM_CONFIGS), checkDates, conversation));
    }
    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const store = readStore();
      const role = getRole(req);
      const table = url.searchParams.get('table');
      if (role && !table) return sendJson(res, 200, { orders: store.orders.map(order => orderForRole(order, role)).filter(Boolean) });
      if (!table) return sendJson(res, 401, { error: 'Chỉ nhân viên mới xem được toàn bộ yêu cầu.' });
      const room = store.rooms.find(row => `Phòng ${row.number}` === table && row.status === 'occupied');
      if (!roomAccessMatches(room, url.searchParams.get('token'))) return sendJson(res, 403, { error: 'Phiên phòng đã hết hạn hoặc cần xác thực.' });
      return sendJson(res, 200, { orders: ordersForStay(store, room) });
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const table = url.searchParams.get('table');
      const staff = !table && isStaff(req);
      const room = staff ? null : readStore().rooms.find(row => `Phòng ${row.number}` === table);
      if (!staff && !roomAccessMatches(room, url.searchParams.get('token'))) return sendJson(res, 403, { error: 'Cần xác thực phiên phòng.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      const client = { res, staffRequest: staff ? req : null, stayId: room?.stayId };
      streams.add(client);
      const heartbeat = setInterval(() => {
        try {
          res.write(': keep-alive\n\n');
        } catch (_) {
          clearInterval(heartbeat);
          streams.delete(client);
        }
      }, 20000);
      req.on('close', () => { clearInterval(heartbeat); streams.delete(client); }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/room-auth') {
      const roomNumber = Number(url.searchParams.get('room'));
      const token = String(url.searchParams.get('token') || '').trim();
      const pin = String(url.searchParams.get('pin') || '').trim();
      const store = readStore();
      const room = store.rooms.find(item => item.number === roomNumber);
      if (!room) return sendJson(res, 404, { valid: false, error: 'Không tìm thấy phòng trong hệ thống.' });
      if (room.status !== 'occupied') return sendJson(res, 409, { valid: false, error: 'Phòng hiện chưa nhận khách hoặc đang chờ buồng phòng dọn dẹp.' });

      const failureKey = `${req.socket.remoteAddress}:${roomNumber}`;
      const now = Date.now();
      for (const [key, failure] of pinFailures) if (failure.until <= now) pinFailures.delete(key);
      const failure = pinFailures.get(failureKey);
      if (pin && failure?.count >= 6 && !roomAccessMatches(room, token)) {
        return sendJson(res, 429, { valid: false, error: 'Đã nhập sai nhiều lần. Quét lại QR hoặc liên hệ lễ tân.' });
      }
      if (roomAccessMatches(room, token, pin)) {
        pinFailures.delete(failureKey);
        return sendJson(res, 200, {
          valid: true,
          room: room.number,
          guestName: room.guestName,
          typeLabel: room.typeLabel || 'Phòng tiêu chuẩn',
          profile: ROOM_CONFIGS[room.type] || getRoomDefaults(room.number),
          token: room.stayToken
        });
      }
      if (pin) pinFailures.set(failureKey, { count: (failure?.count || 0) + 1, until: failure?.until || now + 5 * 60000 });
      return sendJson(res, 403, { valid: false, error: 'Mã xác thực phòng (Token/PIN) không chính xác.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(req); const table = String(body.table || '').trim();
      if (!table || !Array.isArray(body.items) || !body.items.length || body.items.length > 50) return sendJson(res, 400, { error: 'Số phòng hoặc danh sách dịch vụ không hợp lệ.' });
      const store = readStore(); const items = [];
      const roomNumber = Number(table.replace(/\D/g, '')); const room = store.rooms.find(item => item.number === roomNumber);
      if (!room || room.status !== 'occupied') return sendJson(res, 409, { error: 'Phòng chưa được tiếp tân làm thủ tục nhận phòng hoặc đang chờ dọn dẹp.' });
      if (room.receiptId) return sendJson(res, 409, { error: 'Phòng đã quyết toán. Vui lòng liên hệ lễ tân nếu cần hỗ trợ thêm.' });

      // Bảo mật QR: Kiểm tra Token hoặc PIN phòng nếu là khách gửi đơn (nhân viên không cần check)
      if (!canAccess(getRole(req), ['receptionist']) && !roomAccessMatches(room, body.token)) {
        return sendJson(res, 403, { error: 'Vui lòng quét lại QR hoặc nhập đúng PIN phòng.' });
      }

      for (const row of body.items) {
        const menuItem = store.menu.find(item => item.id === Number(row.id) && item.available !== false);
        const qty = Number(row.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > 50) return sendJson(res, 400, { error: 'Số lượng mỗi dịch vụ phải là số nguyên từ 1 đến 50.' });
        if (!menuItem) return sendJson(res, 409, { error: 'Có dịch vụ tạm thời không khả dụng.' });
        const unitPrice = Math.round(menuItem.price * (100 - (menuItem.salePercent || 0)) / 100);
        items.push({ id: menuItem.id, name: menuItem.name, section: menuItem.section, category: menuItem.category, qty, note: String(row.note || '').slice(0, 120), listPrice: menuItem.price, salePercent: menuItem.salePercent || 0, unitPrice, total: unitPrice * qty });
      }

      const stockUsed = stockRequirements(items);
      const hasStock = stockUsed.every(({ id, qty }) => (store.inventory.find(item => item.id === id)?.quantity || 0) >= qty);
      if (!hasStock) return sendJson(res, 409, { error: 'Số lượng còn lại không đủ cho yêu cầu này. Hãy giảm số lượng hoặc chọn món khác.' });
      for (const { id, qty } of stockUsed) {
        store.inventory.find(item => item.id === id).quantity -= qty;
      }

      const subtotal = items.reduce((sum, item) => sum + item.total, 0); const promotionDiscount = items.reduce((sum, item) => sum + Math.round(item.listPrice * item.qty * item.salePercent / 100), 0);
      const order = { id: `SRV-${Date.now().toString().slice(-7)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`, table: `Phòng ${room.number}`, stayId: room.stayId, items, subtotal, promotionDiscount, voucherCode: '', voucherDiscount: 0, discountTotal: promotionDiscount, totalPrice: subtotal, createdAt: new Date().toISOString(), status: 'pending', stations: { housekeeping: items.some(item => item.section === 'housekeeping') ? 'pending' : null, dining: items.some(item => item.section === 'dining') ? 'pending' : null } };
      order.stockUsed = stockUsed;
      store.orders.unshift(order); writeStore(store); broadcast(order); return sendJson(res, 201, { order });
    }

    // Hỗ trợ hủy đơn dịch vụ
    const cancelRoute = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelRoute) {
      const role = getRole(req);
      if (!canAccess(role, ['receptionist', 'cashier'])) return sendJson(res, role ? 403 : 401, { error: 'Cần quyền hủy yêu cầu dịch vụ.' });
      const store = readStore();
      const order = store.orders.find(row => row.id === decodeURIComponent(cancelRoute[1]));
      if (!order) return sendJson(res, 404, { error: 'Không tìm thấy phiếu yêu cầu dịch vụ.' });
      if (order.status === 'cancelled') return sendJson(res, 200, { order });
      if (order.status !== 'pending') return sendJson(res, 409, { error: 'Chỉ hủy trên hệ thống khi bộ phận chưa tiếp nhận yêu cầu.' });
      for (const { id, qty } of order.stockUsed || []) {
        const inventory = store.inventory.find(item => item.id === id);
        if (inventory) inventory.quantity += qty;
      }
      order.status = 'cancelled';
      order.cancelledAt = new Date().toISOString();
      updateOrder(store, order);
      return sendJson(res, 200, { order });
    }

    if (req.method === 'GET' && url.pathname === '/api/rooms') {
      if (!canAccess(getRole(req), ['receptionist', 'housekeeping'])) return sendJson(res, getRole(req) ? 403 : 401, { error: 'Chỉ nhân viên lễ tân, buồng phòng hoặc quản lý được xem tình trạng phòng.' });
      const rooms = readStore().rooms.map(room => ({ ...room, profile: ROOM_CONFIGS[room.type] || getRoomDefaults(room.number) }));
      return sendJson(res, 200, { rooms });
    }
    const folioRoles = ['receptionist', 'cashier'];
    if (req.method === 'GET' && url.pathname === '/api/folios') {
      const role = getRole(req);
      if (!canAccess(role, folioRoles)) return sendJson(res, role ? 403 : 401, { error: 'Cần quyền xem phiếu quyết toán.' });
      const store = readStore();
      const active = store.rooms.filter(room => room.status === 'occupied').map(room => makeFolio(store, room));
      return sendJson(res, 200, { active, receipts: store.receipts, roomCount: store.rooms.length });
    }

    const receiptRoute = url.pathname.match(/^\/api\/folios\/(HD-[0-9]+-[A-F0-9]+)$/);
    if (req.method === 'GET' && receiptRoute) {
      const role = getRole(req);
      if (!canAccess(role, folioRoles)) return sendJson(res, role ? 403 : 401, { error: 'Cần quyền xem hóa đơn.' });
      const receipt = readStore().receipts.find(row => row.id === receiptRoute[1]);
      return receipt ? sendJson(res, 200, receipt) : sendJson(res, 404, { error: 'Không tìm thấy hóa đơn.' });
    }

    const roomBillRoute = url.pathname.match(/^\/api\/rooms\/(\d+)\/bill$/);
    if (roomBillRoute && ['GET', 'POST'].includes(req.method)) {
      const role = getRole(req);
      if (!canAccess(role, folioRoles)) return sendJson(res, role ? 403 : 401, { error: 'Cần quyền xem và quyết toán hóa đơn phòng.' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      const store = readStore();
      const room = store.rooms.find(row => row.number === Number(roomBillRoute[1]));
      if (!room || room.status !== 'occupied') return sendJson(res, 404, { error: 'Phòng hiện không có lượt lưu trú đang mở.' });
      const now = new Date();
      const folio = makeFolio(store, room, now);
      if (req.method === 'GET') return sendJson(res, 200, folio);
      if (body.stayId !== folio.stayId) return sendJson(res, 409, { error: 'Lượt lưu trú đã đổi. Vui lòng tải lại phiếu.' });
      if (folio.id) return sendJson(res, 200, { receipt: folio });
      if (!folio.canCheckOut) return sendJson(res, 409, { error: 'Bếp hoặc buồng phòng vẫn còn yêu cầu chưa hoàn tất.' });
      if (body.expectedAmount !== folio.amountDue) return sendJson(res, 409, { error: 'Số tiền đã thay đổi. Kiểm tra lại phiếu trước khi xác nhận.' });
      if (!paymentMethods.includes(body.paymentMethod)) return sendJson(res, 400, { error: 'Chọn phương thức thanh toán.' });

      const { receipt, changedOrders } = settleFolio(store, room, folio, body.paymentMethod, now);
      writeStore(store);
      changedOrders.forEach(broadcast);
      broadcastFolio();
      return sendJson(res, 201, { receipt });
    }

    const roomRoute = url.pathname.match(/^\/api\/rooms\/(\d+)$/);
    if (req.method === 'PATCH' && roomRoute) {
      const role = getRole(req); if (!role) return sendJson(res, 401, { error: 'Cần đăng nhập nhân viên khách sạn.' });
      const body = await readBody(req); const store = readStore(); const room = store.rooms.find(item => item.number === Number(roomRoute[1]));
      if (!room) return sendJson(res, 404, { error: 'Không tìm thấy phòng.' });
      if (body.action === 'check_in') {
        if (!canAccess(role, ['receptionist'])) return sendJson(res, 403, { error: 'Chỉ lễ tân hoặc quản lý được làm thủ tục nhận phòng.' });
        const guestName = String(body.guestName || '').trim().slice(0, 80);
        const guestPhone = String(body.guestPhone || '').trim().slice(0, 30);
        const plannedCheckout = String(body.plannedCheckout || '');
        const guests = Number(body.guests ?? 1);
        const profile = ROOM_CONFIGS[room.type] || getRoomDefaults(room.number);
        const now = new Date();
        const today = hotelDay(now);
        if (room.status !== 'available') return sendJson(res, 409, { error: 'Phòng chưa sẵn sàng nhận khách.' });
        if (!guestName || !guestPhone || !validDate(plannedCheckout) || plannedCheckout <= today) return sendJson(res, 400, { error: 'Cần nhập tên khách, số điện thoại và ngày trả phòng hợp lệ.' });
        const reservation = store.reservations.find(row => ['pending', 'confirmed'].includes(String(row.status).toLowerCase()) && (!row.roomType || row.roomType === room.type) && row.phone === guestPhone && row.checkOut === plannedCheckout && row.checkIn <= today);
        if (!reservation && (!Number.isInteger(guests) || guests < 1 || guests > profile.maxGuests)) return sendJson(res, 400, { error: `${profile.typeLabel} nhận tối đa ${profile.maxGuests} khách.` });
        if (availableRooms(store, today, plannedCheckout, room.type, reservation?.id) < 1) return sendJson(res, 409, { error: 'Các phòng loại này đã được giữ cho khách đặt trước trong thời gian lưu trú.' });
        beginStay(room, guestName, guestPhone, plannedCheckout, reservation, now, reservation?.guests || guests);
      } else if (body.action === 'check_out') {
        if (!canAccess(role, ['receptionist'])) return sendJson(res, 403, { error: 'Chỉ lễ tân hoặc quản lý được làm thủ tục trả phòng.' });
        if (room.status !== 'occupied') return sendJson(res, 409, { error: 'Phòng hiện không có khách để trả phòng.' });
        const now = new Date();
        const folio = makeFolio(store, room, now);
        if (body.stayId && body.stayId !== folio.stayId) return sendJson(res, 409, { error: 'Lượt lưu trú đã đổi. Vui lòng tải lại phiếu.' });
        if (!folio.canCheckOut) return sendJson(res, 409, { error: 'Chưa thể trả phòng vì còn dịch vụ đang phục vụ.' });

        let receipt = folio;
        let changedOrders = [];
        if (!receipt.id) {
          if (!body.settleAll) return sendJson(res, 409, { error: 'Cần xác nhận thu tiền phòng và dịch vụ trước khi trả phòng.' });
          if (body.expectedAmount !== folio.amountDue) return sendJson(res, 409, { error: 'Số tiền đã thay đổi. Kiểm tra lại phiếu trước khi xác nhận.' });
          if (!paymentMethods.includes(body.paymentMethod)) return sendJson(res, 400, { error: 'Chọn phương thức thanh toán.' });
          ({ receipt, changedOrders } = settleFolio(store, room, folio, body.paymentMethod, now));
        }

        const checkedOutAt = now.toISOString();
        receipt.checkedOutAt = checkedOutAt;
        const reservation = store.reservations.find(row => row.id === room.reservationId);
        if (reservation) Object.assign(reservation, { status: 'completed', checkedOutAt, updatedAt: checkedOutAt, receiptId: receipt.id });
        Object.assign(room, {
          status: 'cleaning', lastGuestName: room.guestName, lastCheckOut: checkedOutAt, lastReceiptId: receipt.id,
          reservationId: '', guestName: '', guestPhone: '', guests: 0, checkIn: '', plannedCheckout: '',
          checkedInAt: '', stayId: '', receiptId: '', stayToken: '', pin: '', updatedAt: checkedOutAt
        });
        writeStore(store);
        changedOrders.forEach(broadcast);
        for (const client of streams) {
          if (client.stayId !== folio.stayId || client.res.destroyed) continue;
          client.res.write('event: stay-ended\ndata: {}\n\n');
          client.res.end();
        }
        broadcastFolio();
        return sendJson(res, 200, { room, receipt });
      } else if (body.action === 'cleaned') {
        if (!canAccess(role, ['housekeeping'])) return sendJson(res, 403, { error: 'Chỉ buồng phòng hoặc quản lý được xác nhận phòng đã dọn.' });
        if (room.status !== 'cleaning') return sendJson(res, 409, { error: 'Phòng này không nằm trong hàng đợi dọn phòng.' });
        room.status = 'available'; room.updatedAt = new Date().toISOString();
      } else if (body.action === 'maintenance' || body.action === 'maintenance_done') {
        if (!canAccess(role, ['receptionist'])) return sendJson(res, 403, { error: 'Chỉ lễ tân hoặc quản lý được cập nhật tình trạng bảo trì.' });
        if (body.action === 'maintenance' && room.status !== 'available') return sendJson(res, 409, { error: 'Chỉ chuyển phòng trống sang trạng thái bảo trì.' });
        if (body.action === 'maintenance_done' && room.status !== 'maintenance') return sendJson(res, 409, { error: 'Phòng này không ở trạng thái bảo trì.' });
        room.status = body.action === 'maintenance' ? 'maintenance' : 'available'; room.updatedAt = new Date().toISOString();
      } else return sendJson(res, 400, { error: 'Thao tác phòng không hợp lệ.' });
      writeStore(store);
      broadcastFolio();
      return sendJson(res, 200, { room });
    }
    if (req.method === 'GET' && url.pathname === '/api/inventory') {
      if (!canAccess(getRole(req), ['manager'])) return sendJson(res, getRole(req) ? 403 : 401, { error: 'Chỉ quản lý được xem tồn kho.' });
      return sendJson(res, 200, { items: readStore().inventory });
    }
    const inventoryRoute = url.pathname.match(/^\/api\/inventory\/([^/]+)$/);
    if (req.method === 'PATCH' && inventoryRoute) {
      if (!canAccess(getRole(req), ['manager'])) return sendJson(res, getRole(req) ? 403 : 401, { error: 'Chỉ quản lý được điều chỉnh tồn kho.' });
      const body = await readBody(req); const store = readStore(); const item = store.inventory.find(row => row.id === decodeURIComponent(inventoryRoute[1]));
      if (!item) return sendJson(res, 404, { error: 'Không tìm thấy mặt hàng.' });
      const quantity = Number(body.quantity); const minimum = body.minimum === undefined ? item.minimum : Number(body.minimum);
      if (!Number.isInteger(quantity) || quantity < 0 || !Number.isInteger(minimum) || minimum < 0) return sendJson(res, 400, { error: 'Số lượng và mức tồn tối thiểu phải là số nguyên không âm.' });
      item.quantity = quantity; item.minimum = minimum; item.updatedAt = new Date().toISOString();
      writeStore(store);
      broadcastFolio();
      return sendJson(res, 200, { item });
    }

    const stationRoute = url.pathname.match(/^\/api\/orders\/([^/]+)\/station$/);
    if (req.method === 'PATCH' && stationRoute) {
      if (!getRole(req)) return sendJson(res, 401, { error: 'Cần đăng nhập nhân viên khách sạn.' });
      const body = await readBody(req); const station = body.station; const status = body.status;
      if (!canAccess(getRole(req), station === 'housekeeping' ? ['housekeeping'] : ['kitchen'])) return sendJson(res, 403, { error: 'Tài khoản không có quyền xử lý bộ phận này.' });
      if (!['housekeeping', 'dining'].includes(station) || !['pending', 'cooking', 'ready'].includes(status)) return sendJson(res, 400, { error: 'Trạng thái bộ phận không hợp lệ.' });
      const store = readStore(); const order = store.orders.find(row => row.id === decodeURIComponent(stationRoute[1]));
      if (!order || !order.stations[station]) return sendJson(res, 404, { error: 'Không tìm thấy phiếu yêu cầu dịch vụ.' });
      if (['paid', 'cancelled'].includes(order.status)) return sendJson(res, 409, { error: 'Đơn đã đóng và không thể đổi trạng thái phục vụ.' });
      const next = { pending: 'cooking', cooking: 'ready' }[order.stations[station]];
      if (order.stations[station] === status) return sendJson(res, 200, { order: orderForRole(order, getRole(req)) });
      if (status !== next) return sendJson(res, 409, { error: 'Cập nhật lần lượt từ tiếp nhận đến hoàn tất.' });
      order.stations[station] = status;
      const states = Object.values(order.stations).filter(Boolean);
      order.status = states.every(state => state === 'ready') ? 'ready' : states.some(state => state === 'cooking' || state === 'ready') ? 'cooking' : 'pending';
      order.updatedAt = new Date().toISOString(); updateOrder(store, order); return sendJson(res, 200, { order: orderForRole(order, getRole(req)) });
    }
    const payRoute = url.pathname.match(/^\/api\/orders\/([^/]+)\/pay$/);
    if (req.method === 'POST' && payRoute) {
      if (!canAccess(getRole(req), ['cashier', 'receptionist'])) return sendJson(res, getRole(req) ? 403 : 401, { error: 'Chỉ lễ tân, thu ngân hoặc quản lý được xác nhận thanh toán.' });
      const body = await readBody(req); const store = readStore(); const order = store.orders.find(row => row.id === decodeURIComponent(payRoute[1]));
      if (!order) return sendJson(res, 404, { error: 'Không tìm thấy hóa đơn phòng.' });
      if (order.status === 'paid') return sendJson(res, 409, { error: 'Hóa đơn này đã thanh toán lúc check-out.' });
      if (!['ready', 'served'].includes(order.status)) return sendJson(res, 409, { error: 'Chỉ xác nhận thanh toán sau khi bếp và buồng phòng đã hoàn tất phục vụ.' });
      const code = String(body.voucherCode || '').trim().toUpperCase(); let voucherDiscount = 0;
      if (code === 'HOTEL10') voucherDiscount = Math.min(Math.round(order.totalPrice * 0.1), 50000);
      else if (code === 'VIPSTAY' && order.totalPrice >= 200000) voucherDiscount = 50000;
      else if (code) return sendJson(res, 400, { error: 'Mã ưu đãi không hợp lệ.' });
      order.voucherCode = code; order.voucherDiscount = voucherDiscount; order.discountTotal = order.promotionDiscount + voucherDiscount;
      order.amountPaid = Math.max(0, order.totalPrice - voucherDiscount); order.status = 'paid'; order.paidAt = new Date().toISOString(); updateOrder(store, order); return sendJson(res, 200, { order });
    }
    if (req.method === 'GET' && url.pathname === '/api/availability') {
      const checkIn = url.searchParams.get('checkIn') || ''; const checkOut = url.searchParams.get('checkOut') || '';
      const roomType = url.searchParams.get('roomType') || '';
      if (!validDate(checkIn) || !validDate(checkOut) || checkIn < hotelDay() || checkOut <= checkIn || (roomType && !Object.hasOwn(ROOM_CONFIGS, roomType))) return sendJson(res, 400, { error: 'Vui lòng chọn loại phòng và ngày lưu trú hợp lệ.' });
      return sendJson(res, 200, { available: availableRooms(readStore(), checkIn, checkOut, roomType), checkIn, checkOut });
    }
    if (req.method === 'POST' && url.pathname === '/api/reservations') {
      const body = await readBody(req); const guestName = String(body.guestName || '').trim().slice(0, 80); const phone = String(body.phone || '').trim().slice(0, 30);
      const email = String(body.email || '').trim().slice(0, 120).toLowerCase(); const roomType = String(body.roomType || '');
      const checkIn = String(body.checkIn || ''); const checkOut = String(body.checkOut || ''); const guests = Number(body.guests || 1);
      if (!guestName || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Object.hasOwn(ROOM_CONFIGS, roomType) || !validDate(checkIn) || !validDate(checkOut) || checkIn < hotelDay() || checkOut <= checkIn || !Number.isInteger(guests) || guests < 1 || guests > 4) return sendJson(res, 400, { error: 'Vui lòng nhập họ tên, số điện thoại, email hợp lệ, loại phòng, 1–4 khách và ngày lưu trú hợp lệ.' });
      const profile = ROOM_CONFIGS[roomType];
      if (guests > profile.maxGuests) return sendJson(res, 400, { error: `${profile.typeLabel} nhận tối đa ${profile.maxGuests} khách. Hãy chọn hạng phòng phù hợp.` });
      const store = readStore();
      if (availableRooms(store, checkIn, checkOut, roomType) < 1) return sendJson(res, 409, { error: 'Loại phòng này đã hết trong khoảng ngày đã chọn. Hãy chọn loại phòng hoặc ngày khác.' });
      const year = hotelDay().slice(0, 4);
      const id = `BK-${year}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      const reservation = { id, guestName, phone, email, roomType, roomTypeLabel: ROOM_CONFIGS[roomType].typeLabel, checkIn, checkOut, guests, status: 'PENDING', createdAt: new Date().toISOString() };
      store.reservations.unshift(reservation);
      writeStore(store);
      broadcastFolio();
      return sendJson(res, 201, { reservation, available: availableRooms(store, checkIn, checkOut, roomType) });
    }
    if (req.method === 'GET' && url.pathname === '/api/reservations') {
      if (!canAccess(getRole(req), ['receptionist'])) return sendJson(res, getRole(req) ? 403 : 401, { error: 'Chỉ tiếp tân hoặc quản lý được xem yêu cầu đặt phòng.' });
      return sendJson(res, 200, { reservations: readStore().reservations });
    }
    const reservationRoute = url.pathname.match(/^\/api\/reservations\/([^/]+)$/);
    const reservationCheckinRoute = url.pathname.match(/^\/api\/reservations\/([^/]+)\/check-in$/);
    if (req.method === 'GET' && reservationRoute) {
      const reservation = readStore().reservations.find(row => row.id === decodeURIComponent(reservationRoute[1]));
      if (!reservation) return sendJson(res, 404, { error: 'Không tìm thấy mã đặt phòng.' });
      const labels = { pending: 'Đang chờ lễ tân xác nhận', confirmed: 'Đã được lễ tân xác nhận', checked_in: 'Đã nhận phòng', completed: 'Đã hoàn tất lưu trú', rejected: 'Yêu cầu bị từ chối', cancelled: 'Yêu cầu đã hủy' };
      const status = String(reservation.status).toLowerCase();
      const statusLabel = labels[status] || reservation.status;
      if (canAccess(getRole(req), ['receptionist'])) return sendJson(res, 200, { reservation: { ...reservation, status: status.toUpperCase(), statusLabel } });
      const { id, roomType, roomTypeLabel, checkIn, checkOut, createdAt, checkedInAt, checkedOutAt } = reservation;
      return sendJson(res, 200, { reservation: { id, status: reservation.status, statusLabel, roomType, roomTypeLabel, checkIn, checkOut, createdAt, checkedInAt, checkedOutAt } });
    }
    if (req.method === 'POST' && reservationCheckinRoute) {
      if (!canAccess(getRole(req), ['receptionist'])) return sendJson(res, getRole(req) ? 403 : 401, { error: 'Chỉ lễ tân hoặc quản lý được làm thủ tục Check-in.' });
      const bookingId = decodeURIComponent(reservationCheckinRoute[1]).toUpperCase();
      const body = await readBody(req); const roomNumber = Number(body.roomNumber);
      if (!Number.isInteger(roomNumber)) return sendJson(res, 400, { error: 'Vui lòng chọn số phòng hợp lệ.' });
      const store = readStore(); const reservation = store.reservations.find(row => row.id === bookingId);
      if (!reservation) return sendJson(res, 404, { error: 'Không tìm thấy mã đặt phòng.' });
      if (!['pending', 'confirmed'].includes(String(reservation.status).toLowerCase())) return sendJson(res, 409, { error: 'Booking này không còn ở trạng thái chờ nhận phòng.' });
      const now = new Date();
      const today = hotelDay(now);
      if (reservation.checkIn > today || reservation.checkOut <= today) return sendJson(res, 409, { error: 'Ngày lưu trú của booking không phù hợp để nhận phòng hôm nay.' });
      const room = store.rooms.find(item => item.number === roomNumber);
      if (!room) return sendJson(res, 400, { error: 'Phòng không có trong sơ đồ phòng của khách sạn.' });
      if (room.status !== 'available') return sendJson(res, 409, { error: `Phòng ${roomNumber} không còn trống. Hãy tải lại sơ đồ và chọn phòng khác.` });
      if (reservation.roomType && room.type !== reservation.roomType) return sendJson(res, 409, { error: 'Phòng được chọn không đúng loại khách đã đặt.' });
      if (availableRooms(store, today, reservation.checkOut, room.type, reservation.id) < 1) return sendJson(res, 409, { error: 'Không còn đủ phòng đúng loại cho cả kỳ lưu trú. Kiểm tra lại lịch phòng.' });
      beginStay(room, reservation.guestName, reservation.phone, reservation.checkOut, reservation, now);
      writeStore(store);
      broadcastFolio();
      return sendJson(res, 200, { reservation, room, serviceUrl: reservation.serviceUrl });
    }
    if (req.method === 'PATCH' && reservationRoute) {
      if (!canAccess(getRole(req), ['receptionist'])) return sendJson(res, getRole(req) ? 403 : 401, { error: 'Chỉ tiếp tân hoặc quản lý được cập nhật đặt phòng.' });
      const body = await readBody(req); if (!['confirmed', 'rejected', 'cancelled'].includes(body.status)) return sendJson(res, 400, { error: 'Trạng thái đặt phòng không hợp lệ.' });
      const store = readStore(); const reservation = store.reservations.find(row => row.id === decodeURIComponent(reservationRoute[1]));
      if (!reservation) return sendJson(res, 404, { error: 'Không tìm thấy yêu cầu đặt phòng.' });
      if (!['pending', 'confirmed'].includes(String(reservation.status).toLowerCase())) return sendJson(res, 409, { error: 'Đặt phòng đã đóng hoặc đã nhận khách.' });
      reservation.status = body.status; reservation.updatedAt = new Date().toISOString();
      writeStore(store);
      broadcastFolio();
      return sendJson(res, 200, { reservation });
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'API không tồn tại.' });

    let requested = decodeURIComponent(url.pathname === '/' ? '/home.html' : url.pathname);
    if (requested.includes('..')) return sendJson(res, 400, { error: 'Đường dẫn không hợp lệ.' });
    const role = getRole(req);
    const legacyRoutes = {
      '/admin.html': '/manager.html', '/quan-ly.html': '/manager.html',
      '/cashier.html': '/thu-ngan.html',
      '/le-tan.html': '/letan.html', '/buong-phong.html': '/van-hanh.html',
      '/index.html': '/khach-hang.html', '/qrcodes': '/letan.html', '/qrcodes/': '/letan.html', '/qrcodes/index.html': '/letan.html'
    };
    if (requested === '/bep.html' || requested === '/kitchen.html' || requested === '/bep-buong-phong.html' || requested === '/bep-buongphong.html') { res.writeHead(302, { Location: '/van-hanh.html#kitchen' }); return res.end(); }
    if (requested === '/buongphong.html' || requested === '/buong-phong.html') { res.writeHead(302, { Location: '/van-hanh.html#housekeeping' }); return res.end(); }
    if (legacyRoutes[requested]) { res.writeHead(302, { Location: `${legacyRoutes[requested]}${url.search}${url.hash}` }); return res.end(); }
    const pageRoles = { '/van-hanh.html': ['kitchen', 'housekeeping'], '/manager.html': ['manager'], '/thu-ngan.html': ['cashier'], '/letan.html': ['receptionist'] };
    if (pageRoles[requested] && !canAccess(getRole(req), pageRoles[requested])) { res.writeHead(302, { Location: `/staff-login.html?next=${encodeURIComponent(requested)}` }); return res.end(); }
    const staticRequest = requested;
    const file = path.join(ROOT, staticRequest);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) return sendJson(res, 404, { error: 'Không tìm thấy trang.' });
    let resolvedRequest = staticRequest;
    if (fs.statSync(file).isDirectory()) resolvedRequest = path.join(staticRequest, 'index.html');
    const resolvedFile = path.join(ROOT, resolvedRequest);
    if (!resolvedFile.startsWith(ROOT + path.sep) || !fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) return sendJson(res, 404, { error: 'Không tìm thấy trang.' });
    const privateFiles = ['server.js', 'hotel-folio.js', 'hotel-assistant.js'];
    const relativeParts = path.relative(ROOT, resolvedFile).split(path.sep);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
    const type = types[path.extname(resolvedFile).toLowerCase()];
    const staticFolder = relativeParts.length === 1 || ['assets', 'qrcodes'].includes(relativeParts[0].toLowerCase());
    if (!type || !staticFolder || relativeParts.some(part => part.startsWith('.')) || privateFiles.includes(path.basename(resolvedFile).toLowerCase())) {
      return sendJson(res, 404, { error: 'Không tìm thấy trang.' });
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': path.extname(resolvedFile) === '.html' ? 'no-cache' : 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); fs.createReadStream(resolvedFile).pipe(res);
  } catch (error) { if (!res.headersSent) sendJson(res, 500, { error: 'Lỗi máy chủ.', detail: error.message }); else res.end(); }
});

server.on('listening', () => {
  console.log(`GOLDEN HAVEN running at http://localhost:${PORT}`);
  if (PUBLIC_DEPLOYMENT && !publicLoginConfigured) {
    console.warn('Đăng nhập nội bộ cần 5 mật khẩu khác nhau (ít nhất 12 ký tự) trong HOTEL_STAFF_*_PASSWORD.');
  }
  if (LEGACY_PORT !== PORT && !PUBLIC_DEPLOYMENT) {
    const legacyServer = http.createServer(server.listeners('request')[0]);
    legacyServer.on('error', error => console.warn(`Cổng QR cũ ${LEGACY_PORT} không khả dụng: ${error.message}`));
    legacyServer.listen(LEGACY_PORT, '0.0.0.0', () => console.log(`QR compatibility endpoint running at http://localhost:${LEGACY_PORT}`));
  }
});

function listenOnAvailablePort() {
  server.once('error', error => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT) {
      const probe = http.get({ hostname: '127.0.0.1', port: PORT, path: '/api/health', timeout: 1200 }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          try {
            const health = JSON.parse(body);
            if (health.ok && (health.service === 'hotel-room-service' || String(health.app || '').includes('Cloud Hotel'))) {
              console.log(`Máy chủ khách sạn đã chạy tại http://localhost:${PORT}; dùng cửa sổ đó, không mở thêm cổng.`);
              process.exitCode = 0;
              return;
            }
          } catch (_) { }
          console.error(`Cổng ${PORT} đang được ứng dụng khác sử dụng. Đóng ứng dụng đó hoặc đặt PORT khác rồi chạy lại.`);
          process.exitCode = 1;
        });
      });
      probe.on('timeout', () => probe.destroy(new Error('timeout')));
      probe.on('error', probeError => {
        console.error(`Không thể mở cổng ${PORT}: ${probeError.message}. Hãy kiểm tra tiến trình đang giữ cổng rồi chạy lại.`);
        process.exitCode = 1;
      });
      return;
    }
    console.error(`Không thể mở máy chủ tại cổng ${PORT}: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(PORT, '0.0.0.0');
}
listenOnAvailablePort();
