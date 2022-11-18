// Copied From https://github.com/frumperino/FrekvensPanel
// by /u/frumperino
// goodwires.org

#ifndef __OBEGRAENSADPANEL_H
#define __OBEGRAENSADPANEL_H

#include <Arduino.h>
#include <Adafruit_GFX.h>

class ObegraensadPanel : public Adafruit_GFX
{
private:
    unsigned short _pLatch;
    unsigned short _pClock;
    unsigned short _pData;
    unsigned short* buf;
    unsigned short _width;
    unsigned short _height;

public:
    ObegraensadPanel(int p_latch, int p_clock, int p_data);

    void init(int p_latch, int p_clock, int p_data);
    void clear();
    void scan();

    boolean getPixel(int16_t x, int16_t y);

    unsigned short width();
    unsigned short height();

    void drawPixel(int16_t x, int16_t y, uint16_t color) override;
    void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) override;
    void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) override;
    void fillScreen(uint16_t color) override;

private:
    unsigned short coordToIndex(int16_t x, int16_t y);

};


#endif //__OBEGRAENSADPANEL_H
