// Copied From https://github.com/frumperino/FrekvensPanel
// By /u/frumperino
// goodwires.org

#include "obegraensad-driver.h"

// lookup tables for led-indices
// stores the bottom-most value in each column, split for bottom and top half of the display
const int lookupTop[] = {254, 14, 253, 13, 250, 10, 249, 9, 246, 6, 245, 5, 242, 2, 241, 1};
const int lookupBottom[] = {255, 15, 252, 12, 251, 11, 248, 8, 247, 7, 244, 4, 243, 3, 240, 0};

ObegraensadPanel::ObegraensadPanel(int p_latch, int p_clock, int p_data) : Adafruit_GFX(16, 16)
{
    init(p_latch, p_clock, p_data);
}

void ObegraensadPanel::init(int p_latch, int p_clock, int p_data)
{
    _pLatch = p_latch;
    _pClock = p_clock;
    _pData = p_data;
    pinMode(_pLatch, OUTPUT);
    pinMode(_pClock, OUTPUT);
    pinMode(_pData, OUTPUT);
  
    _width = 16;
    _height = 16;

    buf = (unsigned short*) malloc(16 * sizeof(unsigned short));
    }

// Converts Coordinates to LED Indices. Matrix has the schema:

//  +---------+---------+---------+---------+---------+
//  |  +----+ |  +----+ |  +----+ |  +----+ |  +----+ |
//  |  |    | |  |    | |  |    | |  |    | |  |    | |
//  |  |    | |  |    | |  |    | |  |    | |  |    | |
//  |  |    | |  |    | |  |    | |  |    | |  |    | |
//  |  v    | |  v    | |  v    | |  v    | |  v    | |
//  | 254  14 |253   13 |  <...>  |242    2 |241    1 |
//  +---------+---------+---------+---------+---------+
//  |  +----+ |  +----+ |  +----+ |  +----+ |  +----+ |
//  |  |    | |  |    | |  |    | |  |    | |  |    | |
//  |  |    | |  |    | |  |    | |  |    | |  |    | |
//  |  |    | |  |    | |  |    | |  |    | |  |    | |
//  |  v    | |  v    | |  v    | |  v    | |  v    | |
//  | 255  15 | 252  12 |  <...>  | 243   3 | 240   0 |
//  +---------+---------+---------+---------+---------+
//   along the arrows: increase by 16 per field
unsigned short ObegraensadPanel::coordToIndex(int16_t x, int16_t y)
{
    // Lookup Table for base column values
    auto lookup = (y > 7) ? lookupBottom : lookupTop;

    // Offset from value in bottom-most row of this column
    auto columnOffset = (7 - (y % 8)) * 16;

    int index;
    if (x % 2 == 0)
    {
        // even column --> led-indices in column go down (seen from bottom-most row)
        index = lookup[x] - columnOffset;
    } else
    {
        // odd column --> led-indices in column go up (seen from bottom-most row)
        index = lookup[x] + columnOffset;
    }
    return index;
}

void ObegraensadPanel::clear()
{
    for (int i=0; i<16; i++)
    {
      buf[i] = 0;
    }
}

void ObegraensadPanel::scan()
{
    unsigned short* p = &buf[0];
    for (int i=0;i<16;i++)
    {
        unsigned short color = *p++;
        for (int j=0; j<16; j++)
        {
            digitalWrite(_pData, color & 0x01);
            color >>= 1;
            digitalWrite(_pClock, HIGH);
            delayMicroseconds(1);
            digitalWrite(_pClock, LOW);
        }
    }
    digitalWrite(_pLatch,HIGH);
    delayMicroseconds(1);
    digitalWrite(_pLatch,LOW);
}

unsigned short ObegraensadPanel::width()
{
    return this->_width;
}

unsigned short ObegraensadPanel::height()
{
    return this->_height;
}

boolean ObegraensadPanel::getPixel(int16_t x, int16_t y)
{
    //TODO: implement
    return false;
}

void ObegraensadPanel::drawPixel(int16_t x, int16_t y, uint16_t color)
{
    if ((x >= 0) && (y >= 0) && (x < _width) && ( y < _height))
    {
        // bit index from start of buf
        auto index = coordToIndex(x, y);
      
        // transform index into page (unsigned short) + offset into the short 
        auto pageIndex = index % 16;
        auto page = &buf[pageIndex];
        auto offset = index / 16;
        
        // Shift Bit to correct position 
        auto shifted = (1 << offset);

        // If color is set add to page
        if (color != 0)
        {
          // OR to add to page
          *page |= shifted;
        } else
        {
          // AND with inverse to remove from page
          *page &= (0xFFFF ^ shifted);
        }
    }
}

void ObegraensadPanel::drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color)
{
    for (int i=0;i<h;i++)
    {
        drawPixel(x,y+i,color);
    }

}

void ObegraensadPanel::drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color)
{
    for (int i=0;i<w;i++)
    {
        drawPixel(x+i,y,color);
    }
}

void ObegraensadPanel::fillScreen(uint16_t color) {
    auto fillColor = (color == 0) ? 0x00 : 0xFFFF;
    for (int i=0; i<16; i++)
    {
        buf[i] = fillColor;
    }
}
