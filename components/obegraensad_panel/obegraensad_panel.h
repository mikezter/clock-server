#pragma once

#include <cstdint>

#include "esphome/components/display/display_buffer.h"
#include "esphome/core/hal.h"

namespace esphome {
namespace obegraensad_panel {

// IKEA Obegränsad 16x16 LED panel: a chain of shift registers driven over
// three GPIOs (data + clock, then a latch pulse commits the frame).
// The frame is kept as 256 bits, already in the order they are shifted out.
class ObegraensadPanel : public display::DisplayBuffer {
 public:
  void set_latch_pin(InternalGPIOPin *pin) { this->latch_pin_ = pin; }
  void set_clock_pin(InternalGPIOPin *pin) { this->clock_pin_ = pin; }
  void set_data_pin(InternalGPIOPin *pin) { this->data_pin_ = pin; }

  void setup() override;
  void update() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::PROCESSOR; }

  display::DisplayType get_display_type() override { return display::DisplayType::DISPLAY_TYPE_BINARY; }
  void fill(Color color) override;

 protected:
  static constexpr int SIZE = 16;

  int get_width_internal() override { return SIZE; }
  int get_height_internal() override { return SIZE; }
  void draw_absolute_pixel_internal(int x, int y, Color color) override;
  void write_frame_();

  InternalGPIOPin *latch_pin_{nullptr};
  InternalGPIOPin *clock_pin_{nullptr};
  InternalGPIOPin *data_pin_{nullptr};
  // Direct register access for the shift-out loop (skips Arduino digitalWrite overhead).
  ISRInternalGPIOPin latch_;
  ISRInternalGPIOPin clock_;
  ISRInternalGPIOPin data_;

  // LED with index i lives at frame_[i % 16], bit (i / 16).
  uint16_t frame_[SIZE]{};
};

}  // namespace obegraensad_panel
}  // namespace esphome
