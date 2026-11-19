const { randomUUID } = require('node:crypto');

const hotelDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
const hotelDay = (date = new Date()) => hotelDayFormat.format(date);
const isReady = order => ['ready', 'served'].includes(order.status);
const paymentMethods = ['cash', 'transfer', 'card', 'other'];

function ordersForStay(store, room) {
  const start = room.checkedInAt || room.updatedAt;
  return store.orders.filter(order => {
    if (order.table !== `Phòng ${room.number}`) return false;
    if (order.stayId) return order.stayId === room.stayId;
    if (!Number.isFinite(Date.parse(order.createdAt))) return false;
    if (room.lastCheckOut && order.createdAt <= room.lastCheckOut) return false;
    if (Number.isFinite(Date.parse(start)) && hotelDay(new Date(start)) === room.checkIn) return order.createdAt >= start;
    return hotelDay(new Date(order.createdAt)) >= room.checkIn;
  });
}

function makeFolio(store, room, now = new Date()) {
  const receipt = store.receipts.find(row => row.id === room.receiptId);
  if (receipt) return receipt;
  const reservation = store.reservations.find(row => row.id === room.reservationId);
  const checkIn = room.checkIn || hotelDay(now);
  const today = hotelDay(now);
  const nights = Math.max(1, Math.round((Date.parse(today) - Date.parse(checkIn)) / 86400000));
  const orders = ordersForStay(store, room).filter(order => order.status !== 'cancelled');
  const unpaidOrders = orders.filter(order => order.status !== 'paid');
  const paidOrders = orders.filter(order => order.status === 'paid');
  const servicesUnpaid = unpaidOrders.reduce((sum, order) => sum + order.totalPrice, 0);
  const servicesPaid = paidOrders.reduce((sum, order) => sum + (order.amountPaid ?? order.totalPrice), 0);
  const roomTotal = nights * room.pricePerNight;
  return {
    stayId: room.stayId,
    room: {
      number: room.number, guestName: room.guestName, guestPhone: room.guestPhone,
      typeLabel: room.typeLabel, reservationId: room.reservationId,
      bookedAt: reservation?.createdAt, checkedInAt: room.checkedInAt || reservation?.checkedInAt,
      checkIn, plannedCheckout: room.plannedCheckout, nights, pricePerNight: room.pricePerNight, roomTotal
    },
    orders, unpaidOrders, paidOrders, servicesUnpaid, servicesPaid, servicesTotal: servicesUnpaid + servicesPaid,
    grandTotal: roomTotal + servicesUnpaid + servicesPaid,
    amountDue: roomTotal + servicesUnpaid, canCheckOut: unpaidOrders.every(isReady)
  };
}

function settleFolio(store, room, folio, method, now) {
  const paidAt = now.toISOString();
  const changedOrders = folio.unpaidOrders;
  for (const order of changedOrders) {
    order.status = 'paid';
    order.paidAt = paidAt;
    order.amountPaid = order.totalPrice;
    order.paymentMethod = method;
  }
  const receipt = {
    ...folio,
    id: `HD-${hotelDay(now).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
    paidAt, paymentMethod: method, amountReceived: folio.amountDue, amountDue: 0,
    paidOrders: folio.orders, unpaidOrders: []
  };
  store.receipts.unshift(receipt);
  room.receiptId = receipt.id;
  return { receipt, changedOrders };
}

module.exports = { hotelDay, makeFolio, ordersForStay, paymentMethods, settleFolio };
