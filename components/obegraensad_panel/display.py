import esphome.codegen as cg
import esphome.config_validation as cv
from esphome import pins
from esphome.components import display
from esphome.const import CONF_ID, CONF_LAMBDA, CONF_PAGES

CONF_LATCH_PIN = "latch_pin"
CONF_CLOCK_PIN = "clock_pin"
CONF_DATA_PIN = "data_pin"

obegraensad_panel_ns = cg.esphome_ns.namespace("obegraensad_panel")
ObegraensadPanel = obegraensad_panel_ns.class_(
    "ObegraensadPanel", display.DisplayBuffer
)

CONFIG_SCHEMA = cv.All(
    display.FULL_DISPLAY_SCHEMA.extend(
        {
            cv.GenerateID(): cv.declare_id(ObegraensadPanel),
            cv.Required(CONF_LATCH_PIN): pins.internal_gpio_output_pin_schema,
            cv.Required(CONF_CLOCK_PIN): pins.internal_gpio_output_pin_schema,
            cv.Required(CONF_DATA_PIN): pins.internal_gpio_output_pin_schema,
        }
    ).extend(cv.polling_component_schema("200ms")),
    cv.has_at_most_one_key(CONF_PAGES, CONF_LAMBDA),
)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await display.register_display(var, config)

    cg.add(var.set_latch_pin(await cg.gpio_pin_expression(config[CONF_LATCH_PIN])))
    cg.add(var.set_clock_pin(await cg.gpio_pin_expression(config[CONF_CLOCK_PIN])))
    cg.add(var.set_data_pin(await cg.gpio_pin_expression(config[CONF_DATA_PIN])))

    if CONF_LAMBDA in config:
        lambda_ = await cg.process_lambda(
            config[CONF_LAMBDA], [(display.DisplayRef, "it")], return_type=cg.void
        )
        cg.add(var.set_writer(lambda_))
