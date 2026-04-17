function parsePrice(rawValue) {
  const raw = String(rawValue || '').trim();

  if (!raw) {
    return {
      price: 0,
      parsedText: '',
      parseStatus: 'empty'
    };
  }

  const normalizedSpaces = raw.replace(/\u00A0/g, ' ').trim();
  const compact = normalizedSpaces.replace(/[ \t\r\n,.;:]/g, '');

  if (/^\d+$/.test(compact)) {
    return {
      price: Number.parseInt(compact, 10) || 0,
      parsedText: compact,
      parseStatus: 'ok'
    };
  }

  const firstNumber = normalizedSpaces.match(/\d+/);
  if (!firstNumber) {
    return {
      price: 0,
      parsedText: normalizedSpaces,
      parseStatus: 'no_digits'
    };
  }

  return {
    price: Number.parseInt(firstNumber[0], 10) || 0,
    parsedText: firstNumber[0],
    parseStatus: 'ok'
  };
}

function classifyPrice(price, minValidPrice) {
  return price >= minValidPrice ? 'valid' : 'review';
}

module.exports = {
  parsePrice,
  classifyPrice
};