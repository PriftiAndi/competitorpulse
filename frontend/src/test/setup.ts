import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement <dialog> methods.
for (const [name, impl] of [
  ["showModal", function (this: HTMLDialogElement) { this.setAttribute("open", ""); }],
  ["close", function (this: HTMLDialogElement) { this.removeAttribute("open"); }],
] as const) {
  if (!(name in HTMLDialogElement.prototype)) {
    Object.defineProperty(HTMLDialogElement.prototype, name, { value: impl, configurable: true, writable: true });
  }
}

afterEach(() => cleanup());
