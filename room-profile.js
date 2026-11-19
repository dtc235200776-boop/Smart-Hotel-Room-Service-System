const RoomProfile = (() => {
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const rate = amount => `${Number(amount).toLocaleString('vi-VN')}đ`;
  function details(profile, { heading = true } = {}) {
    return `
      ${heading ? `<h3>${safe(profile.typeLabel)}</h3>` : ''}
      <p class="room-profile-description">${safe(profile.description)}</p>
      <dl class="room-profile-facts">
        <div><dt>Diện tích</dt><dd>${profile.area} m²</dd></div>
        <div><dt>Sức chứa</dt><dd>${profile.maxGuests} khách</dd></div>
        <div><dt>Bố trí giường</dt><dd>${safe(profile.bed)}</dd></div>
      </dl>
      <ul class="room-profile-amenities">${profile.amenities.map(value => `<li>${safe(value)}</li>`).join('')}</ul>`;
  }
  function photo(profile) {
    return `<img class="room-profile-photo" src="${safe(profile.image)}" alt="Ảnh minh họa ${safe(profile.typeLabel.toLowerCase())}" width="900" height="550" loading="lazy" decoding="async">`;
  }
  return { safe, rate, details, photo };
})();
