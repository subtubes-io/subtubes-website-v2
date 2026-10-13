import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { Input } from "./input";

const meta = {
  title: "UI/Input",
  component: Input,
  args: { id: "example-input", placeholder: "Enter your email" },
  decorators: [
    (Story) => (
      <label className="field-label" style={{ maxWidth: 360 }}>
        Example input
        <Story />
      </label>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", { name: "Example input" });
    await userEvent.type(input, "designer@example.test");
    await expect(input).toHaveValue("designer@example.test");
  },
};
export const Disabled: Story = { args: { disabled: true } };
export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "invalid-email", type: "email" },
};
export const Password: Story = {
  args: { type: "password", placeholder: "At least 10 characters" },
  decorators: [
    (Story) => (
      <div className="form-hint">
        Password inputs preserve native masking and autocomplete attributes.
        <Story />
      </div>
    ),
  ],
};
export const DeviceCode: Story = {
  args: { className: "site-input-code", placeholder: "ABCD1234" },
};
