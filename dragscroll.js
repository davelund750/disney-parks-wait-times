// Drag-to-scroll, for the kiosk's touchscreen and for a mouse.
//
// The kiosk's touchscreen is set up with "mouse emulation" (labwc's
// rc.xml), so a swipe reaches the browser as a mouse drag, and browsers don't
// scroll on a mouse drag. This scrolls `el` when it's dragged up or down. A
// drag can start anywhere, including on a button; the click that ends a drag
// is swallowed, so swiping through a list doesn't also pick whatever the
// swipe started on. A tap (moving less than a few pixels) is still a tap.
function enableDragScroll(el) {
  const THRESHOLD_PX = 8;
  let start = null; // { y, scrollTop } while the button is down
  let dragging = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    start = { y: e.clientY, scrollTop: el.scrollTop };
    dragging = false;
  });

  window.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    if (!dragging && Math.abs(dy) > THRESHOLD_PX) {
      dragging = true;
      el.classList.add("dragging");
    }
    if (dragging) el.scrollTop = start.scrollTop - dy;
  });

  window.addEventListener("pointerup", () => {
    if (dragging) {
      // The release is about to produce a click; don't let it press anything.
      const swallow = (e) => {
        e.stopPropagation();
        e.preventDefault();
      };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
    }
    start = null;
    dragging = false;
    el.classList.remove("dragging");
  });
}
