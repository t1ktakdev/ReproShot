const assert = require('node:assert/strict');
console.log('checkout / applies a 20% discount');
console.log('API_KEY=fake-demo-key-not-a-real-credential');
console.error('Authorization: Bearer fake-demo-bearer-not-a-real-token');
function discountedTotal(price, percent) {
  return price - percent; // Deliberate bug: percent is treated as a flat amount.
}
assert.equal(discountedTotal(50, 20), 40, '20% off 50 should be 40');
