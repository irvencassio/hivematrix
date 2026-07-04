#!/usr/bin/env python3
"""Snake — a classic terminal-based snake game using curses."""

import curses
import random

def main(stdscr):
    curses.curs_set(0)                     # hide cursor
    stdscr.nodelay(1)                      # non-blocking getch
    stdscr.timeout(100)                    # refresh every 100ms

    # terminal size
    h, w = stdscr.getmaxyx()
    # leave border + status line
    game_h = h - 1
    game_w = w - 1

    # initial snake (head at centre, tail going left)
    cx, cy = game_w // 2, game_h // 2
    snake = [(cx - 2, cy), (cx - 1, cy), (cx, cy)]
    direction = (1, 0)                    # moving right
    prev_dir = direction

    # food
    def place_food():
        while True:
            fx = random.randrange(1, game_w - 1)
            fy = random.randrange(1, game_h - 1)
            if (fx, fy) not in snake:
                return fx, fy

    fx, fy = place_food()
    score = 0
    paused = False
    game_over = False

    while not game_over:
        # --- input ---
        ch = stdscr.getch()
        if ch == ord('q'):
            break
        if ch == ord('p') or ch == ord('P'):
            paused = not paused
        if not paused:
            # arrow keys
            if ch == curses.KEY_UP and prev_dir != (0, 1):
                direction = (0, -1)
            elif ch == curses.KEY_DOWN and prev_dir != (0, -1):
                direction = (0, 1)
            elif ch == curses.KEY_LEFT and prev_dir != (1, 0):
                direction = (-1, 0)
            elif ch == curses.KEY_RIGHT and prev_dir != (-1, 0):
                direction = (1, 0)

        # --- update ---
        if not paused and not game_over:
            prev_dir = direction
            dx, dy = direction
            head_x, head_y = snake[-1]
            new_x = head_x + dx
            new_y = head_y + dy

            # wall collision
            if new_x <= 0 or new_x >= game_w - 1 or new_y <= 0 or new_y >= game_h - 1:
                game_over = True
                continue

            # self collision
            if (new_x, new_y) in snake:
                game_over = True
                continue

            # move
            snake.append((new_x, new_y))
            if (new_x, new_y) == (fx, fy):
                score += 1
                fx, fy = place_food()
            else:
                snake.pop(0)

        # --- draw ---
        stdscr.clear()

        # border (ASCII)
        border = '#' * w
        stdscr.addstr(0, 0, border)
        for y in range(1, game_h):
            stdscr.addch(y, 0, '#')
            stdscr.addch(y, w - 1, '#')
        stdscr.addstr(game_h, 0, border)

        # food
        stdscr.addch(fy, fx, '@' | curses.A_BOLD)

        # snake
        for i, (sx, sy) in enumerate(snake):
            ch = 'O' if i == len(snake) - 1 else 'o'
            stdscr.addch(sy, sx, ch)

        # status line
        status = f" Score: {score}  "
        if paused:
            status += " [PAUSED] "
        status += " [Q: quit] [P: pause] "
        stdscr.addstr(game_h, 1, status)

        stdscr.refresh()

    # game-over screen
    stdscr.clear()
    msg = f" GAME OVER — Score: {score} "
    cx = (w - len(msg)) // 2
    cy = h // 2
    stdscr.addstr(cy, cx, msg)
    stdscr.addstr(cy + 1, (w - 25) // 2, " Press any key to exit ")
    stdscr.nodelay(0)
    stdscr.getch()

if __name__ == "__main__":
    curses.wrapper(main)
