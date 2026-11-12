import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("opens and closes with the prop, routes both buttons, and shows errors", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open={false} title="Sure?" confirmLabel="Do it" onConfirm={onConfirm} onCancel={onCancel}>
        body
      </ConfirmDialog>,
    );
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open");

    rerender(
      <ConfirmDialog open title="Sure?" confirmLabel="Do it" error="nope" onConfirm={onConfirm} onCancel={onCancel}>
        body
      </ConfirmDialog>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByText("nope")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Do it" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while busy", () => {
    render(
      <ConfirmDialog open busy title="t" confirmLabel="Go" onConfirm={() => {}} onCancel={() => {}}>
        b
      </ConfirmDialog>,
    );
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
