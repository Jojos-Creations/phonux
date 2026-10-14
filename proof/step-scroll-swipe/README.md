# Swipe trace

Drives the phonux-app web build (`npx vite`, port 5173) with a trackpad-like wheel stream (ramp up, peak, fade, 16 ms apart) and prints
each panel's left and width after every swipe. One swipe must move one stop: a wide panel shows 1, 2, 3 slots in turn.

    SWIPE=-1,-1,-1,1,1,1 node swipe-trace.mjs 2000 visible 7 6:2     # URL=<app url> to change the port
