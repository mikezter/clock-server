# esphome IKEA LED matrix components for Frekvens & Obegränsad

A custom component for esphome to interface with IKEA's Frekvens Cube and Obegränsad panel.

## Sources

This repo is heavily based on the original [FrekvensPanel library by @frumperino](https://github.com/frumperino/FrekvensPanel).

It's also inspired from the esphome component PCD8544.

## Usage

Currently there is a dependency upon Adafruit GFX library. In your esphome config, add these lines:

- Declare necessary libraries
- Define frekvenspanel component

```yaml
    lib_deps:
      - Wire                            # Also required by GFX.
      - SPI                             # Also required by GFX.
      - adafruit/Adafruit BusIO         # Required by GFX Library.
      - adafruit/Adafruit GFX Library   # Required for FrekvensPanel.
      - me-no-dev/ESPAsyncTCP
```

Here is a short config to demonstrate the usage to display time on Frekvens and Obegränsad:

### Frekvens
```yaml
esphome:
  name: frekvens-clock
  platform: ESP8266
  board: d1_mini
  platformio_options:
    lib_deps:
      - Wire                            # Also required by GFX.
      - SPI                             # Also required by GFX.
      - adafruit/Adafruit BusIO         # Required by GFX Library.
      - adafruit/Adafruit GFX Library   # Required for FrekvensPanel.
      - me-no-dev/ESPAsyncTCP

external_components:
  - source: github://phiten/esphome-ikea-led-matrix@master
    components: [ frekvens_panel ]

light:
  - platform: monochromatic
    name: 'Brightness'
    output: matrix_brightness
    restore_mode: RESTORE_DEFAULT_ON

output:
  - platform: esp8266_pwm
    # Enables brightness control.
    max_power: 0.05
    id: matrix_brightness
    pin:
      number: GPIO14
      inverted: True

time:
  - platform: sntp
    id: ntp_time
    timezone: 'Europe/Berlin'

font:
  - file: "04B03.ttf"
    id: b03
    size: 8

display:
  - platform: frekvens_panel
    rotation: 90
    latch_pin: 12
    clock_pin: 04
    data_pin: 05

    lambda: |-
      it.strftime(4, 0, id(b03), "%H", id(ntp_time).now());
      it.strftime(4, 8, id(b03), "%M", id(ntp_time).now());

```

### Obegränsad
```yaml
esphome:
  name: obegraensad-clock
  platform: ESP8266
  board: d1_mini
  platformio_options:
    lib_deps:
      - Wire                            # Also required by GFX.
      - SPI                             # Also required by GFX.
      - adafruit/Adafruit BusIO         # Required by GFX Library.
      - adafruit/Adafruit GFX Library   # Required for FrekvensPanel.
      - me-no-dev/ESPAsyncTCP

external_components:
  - source: github://phiten/esphome-ikea-led-matrix@master
    components: [ obegraensad_panel ]

light:
  - platform: monochromatic
    name: 'Brightness'
    output: matrix_brightness
    restore_mode: RESTORE_DEFAULT_ON

output:
  - platform: esp8266_pwm
    # Enables brightness control.
    id: matrix_brightness
    pin:
      number: GPIO14
      inverted: True

time:
  - platform: sntp
    id: ntp_time
    timezone: 'Europe/Berlin'

font:
  - file: "04B03.ttf"
    id: b03
    size: 8

display:
  - platform: obegraensad_panel
    rotation: 90
    latch_pin: 12
    clock_pin: 04
    data_pin: 05

    lambda: |-
      it.strftime(4, 0, id(b03), "%H", id(ntp_time).now());
      it.strftime(4, 8, id(b03), "%M", id(ntp_time).now());

```

## License
[TBD] the original library does not specify the license. This repo is consecutively not licensed yet either.

## Credits
Thanks to @speckij