const HotelPayment = (() => {
  const details = fetch('/api/payment-info', { cache: 'no-store' })
    .then(response => response.ok ? response.json() : {})
    .then(({ bank }) => {
      document.body.classList.toggle('hotel-has-vietqr', Boolean(bank));
      return bank;
    }).catch(() => null);

  async function getQr(amount, reference) {
    const bank = await details;
    if (!bank) return null;
    const memo = reference.normalize('NFD').replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 50);
    const query = new URLSearchParams({ amount: Math.round(amount), addInfo: memo, accountName: bank.accountName });
    return {
      url: `https://img.vietqr.io/image/${bank.bankId}-${bank.account}-compact2.png?${query}`,
      bankLabel: `${bank.bankId} · STK ${bank.account} · ${bank.accountName}`,
      memo
    };
  }
  return { getQr };
})();
