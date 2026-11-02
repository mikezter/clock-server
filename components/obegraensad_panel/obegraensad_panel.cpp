// LED index mapping based on https://github.com/frumperino/FrekvensPanel
// by /u/frumperino (goodwires.org).

#include "obegraensad_panel.h"

#include "esphome/core/log.h"

namespace esphome {
namespace obegraensad_panel {

static const char *const TAG = "obegraensad_panel";

// The panel is wired as 2x8 blocks of 2 columns. Within each column the LED
// index changes by 16 per row, running up in odd columns and down in even ones:
//
//  +---------+---------+---------+---------+---------+
//  |  +----+ |  +----+ |  +----+ |  +----+ |  +----+ |
//  |  |    | |  |    | |  |    | |  |    | |  |    | |
//  |  v    | |  v    | |  v    | |  v    | |  v    | |
//  | 254  14 |253   13 |  <...>  |242    2 |241    1 |   rows 0-7
//  +---------+---------+---------+---------+---------+
//  |  +----+ |  +----+ |  +----+ |  +----+ |  +----+ |
//  |  |    | |  |    | |  |    | |  |    | |  |    | |
//  |  v    | |  v    | |  v    | |  v    | |  v    | |
//  | 255  15 | 252  12 |  <...>  | 243   3 | 240   0 |   rows 8-15
//  +---------+---------+---------+---------+---------+
//
// The tables hold the index of the bottom LED of each column in each half.
static const uint8_t LOOKUP_TOP[16] = {254, 14, 253, 13, 250, 10, 249, 9, 246, 6, 245, 5, 242, 2, 241, 1};
static const uint8_t LOOKUP_BOTTOM[16] = {255, 15, 252, 12, 251, 11, 248, 8, 247, 7, 244, 4, 243, 3, 240, 0};

static inline uint8_t led_index(int x, int y) {
  const uint8_t *lookup = (y > 7) ? LOOKUP_BOTTOM : LOOKUP_TOP;
  int offset = (7 - (y % 8)) * 16;
  return (x % 2 == 0) ? lookup[x] - offset : lookup[x] + offset;
}

void ObegraensadPanel::setup() {
  this->latch_pin_->setup();
  this->clock_pin_->setup();
  this->data_pin_->setup();
  this->latch_pin_->digital_write(false);
  this->clock_pin_->digital_write(false);
}

void ObegraensadPanel::dump_config() {
  LOG_DISPLAY("", "Obegraensad Panel", this);
  LOG_PIN("  Latch Pin: ", this->latch_pin_);
  LOG_PIN("  Clock Pin: ", this->clock_pin_);
  LOG_PIN("  Data Pin: ", this->data_pin_);
  LOG_UPDATE_INTERVAL(this);
}

void ObegraensadPanel::update() {
  this->do_update_();
  this->write_frame_();
}

void ObegraensadPanel::fill(Color color) {
  uint16_t value = color.is_on() ? 0xFFFF : 0x0000;
  for (auto &word : this->frame_)
    word = value;
}

void HOT ObegraensadPanel::draw_absolute_pixel_internal(int x, int y, Color color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE)
    return;
  uint8_t index = led_index(x, y);
  uint16_t mask = 1u << (index / 16);
  if (color.is_on()) {
    this->frame_[index % 16] |= mask;
  } else {
    this->frame_[index % 16] &= ~mask;
  }
}

void HOT ObegraensadPanel::write_frame_() {
  for (uint16_t word : this->frame_) {
    for (int bit = 0; bit < 16; bit++) {
      this->data_pin_->digital_write(word & 0x01);
      word >>= 1;
      this->clock_pin_->digital_write(true);
      delayMicroseconds(1);
      this->clock_pin_->digital_write(false);
    }
  }
  this->latch_pin_->digital_write(true);
  delayMicroseconds(1);
  this->latch_pin_->digital_write(false);
}

}  // namespace obegraensad_panel
}  // namespace esphome
