import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  argTypes: {
    size: { control: "inline-radio", options: ["default", "compact"] },
  },
  args: { children: "Continue", onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button"));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
export const Secondary: Story = { args: { variant: "secondary" } };
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button");
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
export const Pending: Story = {
  args: { disabled: true, children: "Creating..." },
};
export const FullWidth: Story = {
  args: { fullWidth: true, children: "Sign in" },
};

export const Compact: Story = {
  args: { size: "compact", children: "Save links" },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button");
    await expect(button.getBoundingClientRect().height).toBe(28);
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
export const CompactSecondary: Story = {
  args: { size: "compact", variant: "secondary", children: "Cancel" },
};
export const CompactDisabled: Story = {
  args: { size: "compact", disabled: true, children: "Save links" },
};
export const CompactPending: Story = {
  args: { size: "compact", disabled: true, children: "Saving..." },
};
export const CompactFullWidth: Story = {
  args: { size: "compact", fullWidth: true, children: "Save changes" },
};
