import '@testing-library/jest-dom/vitest';

// jsdom does not implement <dialog>; emulate just enough for components that call showModal().
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ||= function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ||= function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// jsdom has no object URLs; downloads (CSV export, attachments) create them.
URL.createObjectURL ||= () => 'blob:test';
URL.revokeObjectURL ||= () => {};

// Programmatic downloads (<a download>.click()) make jsdom log "navigation not implemented".
const realClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function click() {
  if (this.hasAttribute('download')) return;
  return realClick.call(this);
};

// Not implemented by jsdom (route changes scroll to top; axe probes canvas support): no-ops keep test output clean.
window.scrollTo = () => {};
HTMLCanvasElement.prototype.getContext = () => null;
