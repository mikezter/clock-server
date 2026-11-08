// Static 16x16 bitmaps served at GET /img/<id>. One uint16_t per row, bit 15 = leftmost pixel.
// Ids match the device: 0 = clock, 1..7 below, 8..10 = animations in the firmware,
// 12 = free drawing (stored in the Durable Object, see CUSTOM_IMG in index.js).
// Taken verbatim from the firmware images.h; 11 (all white) stays disabled.

export const IMAGES = {
  1: [65535, 49155, 40965, 36873, 34833, 33825, 33345, 33153, 33153, 33345, 33825, 34833, 36873, 40965, 49155, 65535],  // test
  2: [0, 4080, 12300, 16386, 35889, 35889, 32769, 32769, 36873, 34833, 18018, 12684, 3696, 0, 0, 0],  // smiley
  3: [0, 0, 29568, 65472, 65504, 65520, 32752, 16368, 8160, 4032, 1920, 768, 0, 0, 0, 0],  // heart
  4: [0, 0, 3840, 8064, 16320, 29664, 58352, 50160, 65520, 32752, 16352, 0, 0, 0, 0, 0],  // cloud
  5: [0, 8456, 4368, 1984, 4064, 8176, 24564, 40953, 40953, 24564, 8176, 4064, 1984, 4368, 8456, 0],  // sun
  6: [0, 1984, 3968, 7936, 15872, 31744, 16352, 8176, 4088, 1008, 480, 240, 112, 48, 0, 0],  // lightning
  7: [0, 0, 1920, 32764, 65534, 49158, 53238, 53238, 53238, 53238, 49158, 65534, 32764, 0, 0, 0],  // battery
};
