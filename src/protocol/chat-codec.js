export const CHAT_ALPHABET = " abcdefghijklmnopqrstuvwxyz0123456789.,!?-_/:@+#()[]'\";%&=*<>\n|$";
export const CHAT_MAX_PACKED_BYTES = 24;
export const CHAT_MAX_CHAR_COUNT = Math.floor((CHAT_MAX_PACKED_BYTES * 8) / 6);

const CHAT_INDEX = new Map(Array.from(CHAT_ALPHABET).map((char, index) => [char, index]));

export function getPackedByteLength(charCount) {
  if (!Number.isInteger(charCount) || charCount <= 0) {
    throw new RangeError("charCount must be a positive integer");
  }

  return Math.ceil((charCount * 6) / 8);
}

export function encodePackedMessage(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new RangeError("text must be a non-empty string");
  }

  if (text.length > CHAT_MAX_CHAR_COUNT) {
    throw new RangeError(`text exceeds the ${CHAT_MAX_CHAR_COUNT} character limit`);
  }

  const packed = Buffer.alloc(getPackedByteLength(text.length));
  let bitBuffer = 0;
  let bitCount = 0;
  let offset = 0;

  for (const char of text) {
    const code = CHAT_INDEX.get(char);
    if (code === undefined) {
      throw new RangeError(`Unsupported chat character: ${char}`);
    }

    bitBuffer = (bitBuffer << 6) | code;
    bitCount += 6;

    while (bitCount >= 8) {
      const shift = bitCount - 8;
      packed[offset++] = (bitBuffer >> shift) & 0xff;
      bitBuffer &= (1 << shift) - 1;
      bitCount = shift;
    }
  }

  if (bitCount > 0) {
    packed[offset++] = (bitBuffer << (8 - bitCount)) & 0xff;
  }

  return {
    charCount: text.length,
    packed: packed.subarray(0, offset)
  };
}

export function decodePackedMessage(input, charCount) {
  const packed = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);
  const expectedLength = getPackedByteLength(charCount);

  if (packed.length !== expectedLength) {
    throw new RangeError(`Expected ${expectedLength} packed bytes, received ${packed.length}`);
  }

  let bitBuffer = 0;
  let bitCount = 0;
  let offset = 0;
  let text = "";

  while (text.length < charCount) {
    while (bitCount < 6) {
      if (offset >= packed.length) {
        throw new RangeError("Packed message ended before all characters were decoded");
      }

      bitBuffer = (bitBuffer << 8) | packed[offset++];
      bitCount += 8;
    }

    const shift = bitCount - 6;
    const code = (bitBuffer >> shift) & 0x3f;
    bitBuffer &= (1 << shift) - 1;
    bitCount = shift;

    const char = CHAT_ALPHABET[code];
    if (char === undefined) {
      throw new RangeError(`Unsupported chat code: ${code}`);
    }
    text += char;
  }

  return text;
}
