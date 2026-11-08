#pragma once
#include <stdint.h>

// Frame-based animations (matrix rain, Tetris, border snake), drawn by code.
// The static 16x16 bitmaps (test, smiley, heart, ...) no longer live in the
// firmware: the Worker serves them at GET /img/<id> (see worker/src/IMAGES.js;
// the old C arrays are in git history, e.g. `git show HEAD:images.h`).

// ============================================================
// ANIMATIONS
// These functions take the current anim_frame counter and
// draw directly onto the display each call.
//
// Fake brightness levels are achieved by only lighting a pixel
// on certain frames (e.g. every other frame = ~50% brightness).
// The interval component drives anim_frame forward at 80ms.
//
// Usage in ESPHome lambda:
//   draw_matrix(it, id(anim_frame));
// ============================================================

// ------------------------------------------------------------
// Matrix effect
//
// 16 independent columns, each with a falling "head" and a
// fading trail behind it. Three brightness levels:
//   head        = always on  (full brightness)
//   trail[0..1] = on 2 out of 4 frames (~50%)
//   trail[2..5] = on 1 out of 4 frames (~25%)
//
// Column timing is staggered using a per-column seed so they
// don't all move in lockstep.
// ------------------------------------------------------------

// State lives in static locals so it persists across lambda calls.
inline void draw_matrix(esphome::display::Display &it, int frame) {
  static int  drop_y[16]    = {-3,-7,-1,-5,-9,-2,-6,-4,-8,-1,-5,-3,-7,-2,-6,-4};
  static int  trail_len[16] = { 5, 7, 4, 6, 8, 5, 7, 4, 6, 8, 5, 6, 7, 4, 8, 5};
  static bool initialised   = false;

  // Advance each column every 2 frames (columns move at 40ms per row).
  if (frame % 2 == 0) {
    for (int x = 0; x < 16; x++) {
      drop_y[x]++;
      // Once the whole trail has scrolled off the bottom, restart above top.
      if (drop_y[x] - trail_len[x] > 15) {
        drop_y[x]   = -2 - (x * 3 % 7);   // staggered re-entry
        trail_len[x] = 4 + (x * 7 % 6);    // vary trail length 4..9
      }
    }
  }

  for (int x = 0; x < 16; x++) {
    int head = drop_y[x];
    for (int y = 0; y < 16; y++) {
      int dist = head - y;              // 0 = head, positive = trail behind
      if (dist < 0 || dist > trail_len[x]) continue;

      bool draw = false;
      if (dist == 0) {
        // Head: always on.
        draw = true;
      } else if (dist <= 2) {
        // Near trail: on 2 out of every 4 frames (~50% brightness).
        draw = (frame % 4 < 2);
      } else {
        // Far trail: on 1 out of every 4 frames (~25% brightness).
        draw = (frame % 4 == 0);
      }

      if (draw) it.draw_pixel_at(x, y);
    }
  }
}

// ------------------------------------------------------------
// Tetris effect
//
// Pieces fall from the top, lock at the bottom, full rows
// are cleared. Uses a minimal piece set (7 tetrominoes) and
// a simple PRNG seeded from the frame counter so each run
// looks different. No rotation — keeps the code simple and
// the 16-wide board readable.
//
// Piece advance rate: 1 row every 4 frames (every ~320ms).
// A new game starts automatically when the board fills up.
// ------------------------------------------------------------

// Simple deterministic PRNG (xorshift16).
inline uint16_t xorshift(uint16_t &state) {
  state ^= state << 7;
  state ^= state >> 9;
  state ^= state << 8;
  return state;
}

inline void draw_tetris(esphome::display::Display &it, int frame) {
  // Piece definitions: 4 cells each as {dx, dy} offsets from origin.
  // No rotations — fixed orientation only.
  static const int8_t pieces[7][4][2] = {
    {{ 0,0},{ 1,0},{ 0,1},{ 1,1}},   // O
    {{ 0,0},{ 1,0},{ 2,0},{ 3,0}},   // I (horizontal)
    {{ 0,0},{ 1,0},{ 2,0},{ 2,1}},   // L
    {{ 0,0},{ 1,0},{ 2,0},{ 0,1}},   // J
    {{ 1,0},{ 2,0},{ 0,1},{ 1,1}},   // S
    {{ 0,0},{ 1,0},{ 1,1},{ 2,1}},   // Z
    {{ 0,0},{ 1,0},{ 2,0},{ 1,1}},   // T
  };

  static uint8_t  board[16][16]  = {};   // 0 = empty, 1 = filled
  static int      piece_type     = 0;
  static int      piece_x        = 6;
  static int      piece_y        = 0;
  static int      last_frame     = -1;
  static uint16_t rng            = 0xACE1;
  static bool     need_new_piece = true;
  static int      lock_timer     = 0;

  // Spawn a new piece when needed.
  if (need_new_piece) {
    piece_type     = xorshift(rng) % 7;
    piece_x        = 1 + (xorshift(rng) % 11);   // random column, fits 4-wide
    piece_y        = -1;
    need_new_piece = false;
    lock_timer     = 0;
  }

  // Advance piece downward every 4 frames.
  bool should_advance = (frame != last_frame) && (frame % 4 == 0);
  last_frame = frame;

  if (should_advance) {
    // Try to move down.
    bool blocked = false;
    for (int i = 0; i < 4; i++) {
      int nx = piece_x + pieces[piece_type][i][0];
      int ny = piece_y + pieces[piece_type][i][1] + 1;
      if (ny >= 16 || (ny >= 0 && board[ny][nx])) { blocked = true; break; }
    }

    if (!blocked) {
      piece_y++;
    } else {
      // Lock piece into board.
      for (int i = 0; i < 4; i++) {
        int nx = piece_x + pieces[piece_type][i][0];
        int ny = piece_y + pieces[piece_type][i][1];
        if (ny >= 0 && ny < 16 && nx >= 0 && nx < 16)
          board[ny][nx] = 1;
      }
      // Clear full rows, shift everything down.
      for (int row = 15; row >= 0; row--) {
        bool full = true;
        for (int col = 0; col < 16; col++) if (!board[row][col]) { full = false; break; }
        if (full) {
          for (int r = row; r > 0; r--)
            for (int c = 0; c < 16; c++) board[r][c] = board[r-1][c];
          for (int c = 0; c < 16; c++) board[0][c] = 0;
          row++;   // re-check this row after shift
        }
      }
      // Reset board if top 3 rows are occupied.
      bool overflow = false;
      for (int col = 0; col < 16; col++) if (board[2][col]) { overflow = true; break; }
      if (overflow) memset(board, 0, sizeof(board));

      need_new_piece = true;
    }
  }

  // Draw board.
  for (int y = 0; y < 16; y++)
    for (int x = 0; x < 16; x++)
      if (board[y][x]) it.draw_pixel_at(x, y);

  // Draw active piece.
  for (int i = 0; i < 4; i++) {
    int nx = piece_x + pieces[piece_type][i][0];
    int ny = piece_y + pieces[piece_type][i][1];
    if (ny >= 0 && ny < 16 && nx >= 0 && nx < 16)
      it.draw_pixel_at(nx, ny);
  }
}

inline void draw_snake(esphome::display::Display &it, int frame) {
  static const int8_t edge_x[60] = {
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,15,  // top
    15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,       // right
    14,13,12,11,10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,       // bottom
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0           // left
  };
  static const int8_t edge_y[60] = {
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // top
    1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,15,       // right
    15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,        // bottom
    14,13,12,11,10, 9, 8, 7, 6, 5, 4, 3, 2, 1           // left
  };

  // Snake advances one step every 4 display frames.
  // Sub-frame (0..3) drives the brightness PWM cycle.
  int sub   = frame % 4;          // brightness cycle position
  int head  = (frame / 4) % 60;  // snake head position on edge

  // For each tail segment, draw it only on the frames where
  // it should be "on" to achieve the target brightness:
  //   dist 0 (head) : always on              (4/4 = 100%)
  //   dist 1        : on sub 0,1,2           (3/4 =  75%)
  //   dist 2        : on sub 0,1             (2/4 =  50%)
  //   dist 3        : on sub 0               (1/4 =  25%)
  //   dist 4+       : never on               (0/4 =   0%)
  for (int dist = 0; dist <= 3; dist++) {
    if (sub >= (4 - dist)) continue;   // skip this pixel this sub-frame
    int idx = (head - dist + 60) % 60;
    it.draw_pixel_at(edge_x[idx], edge_y[idx]);
  }
}
