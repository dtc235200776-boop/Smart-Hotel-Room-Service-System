const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { hotelDay } = require('../hotel-folio');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');
const roles = { receptionist: 'letan', cashier: 'thungan', kitchen: 'bep', housekeeping: 'buongphong', manager: 'quanly' };

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function run() {
  const temporary = path.resolve(os.tmpdir());
  const workspace = await fs.mkdtemp(path.join(temporary, 'golden-haven-smoke-'));
  let server;
  try {
    for (const name of ['server.js', 'hotel-folio.js', 'hotel-assistant.js']) {
      await fs.copyFile(path.join(root, name), path.join(workspace, name));
    }
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['server.js'], {
      cwd: workspace, env: { ...process.env, PORT: String(port), RENDER: 'true', HOTEL_AI_ENDPOINT: '' },
      windowsHide: true, stdio: ['ignore', 'ignore', 'inherit']
    });
    async function request(url, { method = 'GET', cookie = '', body } = {}) {
      const response = await fetch(base + url, {
        method, headers: { 'Content-Type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000)
      });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function expected(url, options, status = 200) {
      const response = await request(url, options);
      assert.equal(response.status, status, `${options?.method || 'GET'} ${url} · ${JSON.stringify(response.data)}`);
      return response.data;
    }
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      ready = await request('/api/health').then(result => result.data.service === 'hotel-room-service').catch(() => false);
      if (ready) break;
      await wait(100);
    }
    assert.ok(ready, 'Server did not start');
    const loggedIn = {};
    for (const [role, username] of Object.entries(roles)) {
      const login = await request('/api/login', { method: 'POST', body: { role, username, password: '123456' } });
      assert.equal(login.status, 200);
      loggedIn[role] = login.cookie;
    }
    const { receptionist, cashier, kitchen, housekeeping, manager } = loggedIn;
    const today = hotelDay();
    const tomorrow = hotelDay(new Date(Date.now() + 86400000));
    const booking = (index, roomType, guests = 2) => request('/api/reservations', {
      method: 'POST', body: { guestName: `Demo ${index}`, phone: `090000000${index}`,
        email: `demo${index}@example.invalid`, roomType, checkIn: today, checkOut: tomorrow, guests }
    });
    const catalog = (await expected('/api/room-types')).types;
    assert.deepEqual(catalog.map(room => [room.type, room.area, room.maxGuests]), [
      ['standard', 22, 2], ['deluxe', 32, 3], ['suite', 48, 4]
    ]);
    assert.equal(new Set(catalog.map(room => room.image)).size, 3);
    assert.equal((await booking(6, 'standard', 3)).status, 400);
    assert.equal((await booking(7, 'deluxe', 4)).status, 400);
    assert.equal((await booking(8, 'suite', 4)).status, 201);
    const deluxe = await Promise.all(Array.from({ length: 5 }, (_, index) => booking(index, 'deluxe')));
    const accepted = deluxe.filter(result => result.status === 201);
    assert.equal(accepted.length, 4);
    assert.equal(deluxe.filter(result => result.status === 409).length, 1);
    assert.equal((await booking(5, 'standard')).status, 201);
    const [first, second] = accepted.map(result => result.data.reservation);
    const receive = (reservation, roomNumber) => request(`/api/reservations/${reservation.id}/check-in`, {
      method: 'POST', cookie: receptionist, body: { roomNumber }
    });
    assert.equal((await receive(first, 101)).status, 409, 'Wrong room class must be rejected');
    const competing = await Promise.all([receive(first, 105), receive(second, 105)]);
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 409]);
    const winner = competing.find(result => result.status === 200).data.room;
    const alternate = await receive(competing[0].status === 200 ? second : first, 106);
    assert.equal(alternate.status, 200);
    const guests = [winner, alternate.data.room];
    assert.ok(guests.every(room => room.checkedInAt && room.stayToken));
    const guestRoom = await expected(`/api/room-auth?room=${guests[0].number}&token=${guests[0].stayToken}`);
    assert.equal(guestRoom.profile.type, 'deluxe');
    assert.equal(guestRoom.profile.maxGuests, 3);

    const sendOrder = (room, id) => request('/api/orders', {
      method: 'POST', body: { table: `Phòng ${room.number}`, token: room.stayToken, items: [{ id, qty: 1 }] }
    });
    await expected('/api/inventory/beef', { method: 'PATCH', cookie: manager, body: { quantity: 1 } });
    const competingStock = await Promise.all(guests.map(room => sendOrder(room, 10)));
    assert.deepEqual(competingStock.map(result => result.status).sort(), [201, 409]);
    const reservedOrder = competingStock.find(result => result.status === 201).data.order;
    await expected(`/api/orders/${reservedOrder.id}/cancel`, { method: 'POST', cookie: cashier });
    await expected(`/api/orders/${reservedOrder.id}/cancel`, { method: 'POST', cookie: cashier });
    const restored = (await expected('/api/inventory', { cookie: manager })).items.find(item => item.id === 'beef');
    assert.equal(restored.quantity, 1);
    const food = (await sendOrder(guests[0], 10)).data.order;
    const linen = (await sendOrder(guests[1], 2)).data.order;
    assert.ok(food && linen);

    const ordersLink = (room, token) => `/api/orders?${new URLSearchParams({ table: `Phòng ${room.number}`, token })}`;
    await expected(ordersLink(guests[1], guests[0].stayToken), {}, 403);
    const guestOrders = (await expected(ordersLink(guests[1], guests[1].stayToken))).orders;
    assert.ok(guestOrders.every(order => order.table === 'Phòng 106'));
    assert.ok((await expected('/api/orders', { cookie: kitchen })).orders.every(order => order.items.every(item => item.section === 'dining')));
    assert.ok((await expected('/api/orders', { cookie: housekeeping })).orders.every(order => order.items.every(item => item.section === 'housekeeping')));
    await expected('/api/folios', { cookie: kitchen }, 403);
    const billPath = room => `/api/rooms/${room.number}/bill`;
    const pay = (room, folio) => ({ method: 'POST', cookie: cashier, body: {
      stayId: folio.stayId, expectedAmount: folio.amountDue, paymentMethod: 'cash'
    } });
    const pending = await expected(billPath(guests[0]), { cookie: cashier });
    await expected(billPath(guests[0]), pay(guests[0], pending), 409);
    async function finish(order, station, cookie) {
      for (const status of ['cooking', 'ready']) {
        await expected(`/api/orders/${order.id}/station`, { method: 'PATCH', cookie, body: { station, status } });
      }
    }
    await Promise.all([finish(food, 'dining', kitchen), finish(linen, 'housekeeping', housekeeping)]);
    const bill = await Promise.all(guests.map(room => expected(billPath(room), { cookie: cashier })));
    assert.deepEqual(bill.map(row => row.amountDue), [809000, 750000]);
    const receipts = await Promise.all(guests.map((room, i) => expected(billPath(room), pay(room, bill[i]), 201)));
    assert.notEqual(receipts[0].receipt.id, receipts[1].receipt.id);
    assert.equal((await expected(billPath(guests[0]), pay(guests[0], bill[0]))).receipt.id, receipts[0].receipt.id);
    for (const [i, room] of guests.entries()) {
      const result = await expected(`/api/rooms/${room.number}`, {
        method: 'PATCH', cookie: receptionist, body: { action: 'check_out', stayId: bill[i].stayId }
      });
      assert.equal(result.room.status, 'cleaning');
      assert.ok(result.receipt.checkedOutAt && result.receipt.paidAt);
      await expected(ordersLink(room, room.stayToken), {}, 403);
      await expected(`/api/rooms/${room.number}`, { method: 'PATCH', cookie: housekeeping, body: { action: 'cleaned' } });
    }
    const history = await expected('/api/folios', { cookie: manager });
    assert.equal(history.receipts.length, 2);
    assert.equal(history.active.length, 0);
    const ask = (question, conversation) => expected('/api/assistant', { method: 'POST', body: { question, conversation } });
    const greeting = await ask('trợ lý có ở đây ko');
    assert.match(greeting.text, /Mình đây/);
    assert.doesNotMatch(greeting.text, /Rượu vang/);
    const intro = await ask('giới thiệu tiếp đi', greeting.conversation);
    assert.match(intro.text, /Tiêu chuẩn/i);
    assert.match(intro.text, /Suite/);
    const services = await ask('giới thiệu tiếp đi', intro.conversation);
    assert.match(services.text, /quét QR dịch vụ/i);
    const detail = await ask('Deluxe có gì?');
    assert.match(detail.text, /32 m²/);
    assert.match((await ask('Vậy 2 đêm bao nhiêu?', detail.conversation)).text, /1\.500\.000/);
    const availability = await ask('Phòng đó còn trống không?', detail.conversation);
    assert.match(availability.text, /ngày nào/);
    assert.match((await ask(`${today} đến ${tomorrow}`, availability.conversation)).text, /Deluxe/i);
    const dishes = await ask('Còn phở bò không?', detail.conversation);
    assert.match(dishes.text, /Phở bò/);
    assert.doesNotMatch(dishes.text, /phòng trống/);
    const unknown = await ask('kích thước sao hỏa');
    assert.match(unknown.text, /chưa hiểu/);
    assert.deepEqual((await expected('/api/payment-info')).bank, null);
    console.log('PASS: distinct room profiles and occupancy caps, concurrent reservations and stock, role access, receipts, checkout, and chat follow-ups.');
  } finally {
    if (server && server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    if (path.dirname(path.resolve(workspace)) === temporary && path.basename(workspace).startsWith('golden-haven-smoke-')) {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
